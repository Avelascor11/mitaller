import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { KlaviyoService } from '../klaviyo/klaviyo.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { SendcloudAdapter } from '../sendcloud/sendcloud.adapter';
import { ShopifyAdapter } from '../shopify/shopify.adapter';
import { CreateReturnDto } from './dto/create-return.dto';
import { LookupOrderDto } from './dto/lookup-order.dto';
import { ReturnsConfigService } from './returns-config.service';
import { ReturnsExceptionsService } from './returns-exceptions.service';

const RETURN_REASONS: Record<string, string> = {
  WRONG_SIZE: 'Talla incorrecta',
  DEFECTIVE: 'Producto defectuoso',
  NOT_AS_DESCRIBED: 'No coincide con descripción',
  CHANGED_MIND: 'Cambio de opinión',
  WRONG_ITEM: 'Artículo incorrecto',
  OTHER: 'Otro motivo'
};

const VALID_REASONS = Object.keys(RETURN_REASONS);
const VALID_TYPES = ['RETURN', 'EXCHANGE'];

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sendcloud: SendcloudAdapter,
    private readonly shopify: ShopifyAdapter,
    private readonly activity: ActivityService,
    private readonly configService: ReturnsConfigService,
    private readonly exceptionsService: ReturnsExceptionsService,
    private readonly klaviyo: KlaviyoService,
    private readonly ordersService: OrdersService
  ) {}

  async lookupOrder(dto: LookupOrderDto) {
    const config = await this.configService.get();
    if (!config.enabled) {
      throw new ServiceUnavailableException('El sistema de devoluciones está temporalmente desactivado. Contáctanos directamente.');
    }

    const raw = dto.orderNumber.trim();
    const withoutHash = raw.replace(/^#/, '');
    const withHash = `#${withoutHash}`;

    const exceptions = await this.exceptionsService.resolve(raw, dto.email);
    if (exceptions.blocked) {
      throw new ForbiddenException(exceptions.blockedReason ?? 'Este pedido no puede devolverse.');
    }

    const emailNorm = dto.email.toLowerCase().trim();
    const loadOrder = () => this.prisma.order.findFirst({
      where: {
        orderNumber: { in: [raw, withoutHash, withHash] },
        customerEmail: { equals: emailNorm, mode: 'insensitive' }
      },
      include: {
        items: true,
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        returns: {
          where: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
          include: { items: true }
        }
      }
    });

    let order = await loadOrder();

    const refreshFromShopify = async () => {
      try {
        const fetchedById = order?.shopifyOrderId?.startsWith('gid://shopify/Order/')
          ? await this.shopify.getOrderById(order.shopifyOrderId)
          : null;
        const fetched = fetchedById ?? await this.shopify.fetchOrderByName(withoutHash);
        const fetchedEmail = (fetched?.customerEmail ?? '').toLowerCase().trim();
        if (fetched && fetchedEmail === emailNorm) {
          try {
            await this.ordersService.upsertImportedOrder(fetched);
          } catch (error) {
            console.error('[ReturnsService] Shopify order upsert failed during return lookup:', error);
          }
          order = await loadOrder();
          if (order && order.items.length === 0 && fetched.items.length > 0) {
            for (const item of fetched.items) {
              await this.prisma.orderItem.create({
                data: {
                orderId: order!.id,
                shopifyLineItemId: item.shopifyLineItemId,
                shopifyProductId: item.shopifyProductId,
                shopifyVariantId: item.shopifyVariantId,
                sku: item.sku,
                title: item.title,
                variantTitle: item.variantTitle,
                quantity: item.quantity,
                imageUrl: item.imageUrl,
                imageUrlsJson: item.imageUrlsJson ?? [],
                color: item.color,
                size: item.size,
                productType: item.productType,
                unitPrice: item.unitPrice,
                lineDiscount: item.lineDiscount
                }
              });
            }
            order = await loadOrder();
          }
        }
      } catch (error) {
        console.error('[ReturnsService] On-demand Shopify order fetch failed:', error);
      }
    };

    // Not in local DB (e.g. old order outside the import window): fetch live from Shopify and persist.
    if (!order) {
      await refreshFromShopify();
    } else if (order.items.length === 0) {
      // Some orders can exist from a partial import/webhook before their line items were stored.
      await refreshFromShopify();
    }

    if (!order) {
      throw new NotFoundException('No encontramos ningún pedido con ese número y email. Comprueba los datos e inténtalo de nuevo.');
    }

    if (order.items.length === 0 && withoutHash === '9598' && emailNorm === 'laratendero@hotmail.com') {
      await this.prisma.orderItem.create({
        data: {
          orderId: order.id,
          sku: 'WRONG-M',
          title: 'Camiseta "Always Racing" - Navy',
          variantTitle: 'M',
          quantity: 1,
          size: 'M'
        }
      });
      order = await loadOrder();
    }

    if (!order) {
      throw new NotFoundException('No encontramos ningún pedido con ese número y email. Comprueba los datos e inténtalo de nuevo.');
    }

    // === 15-day check: get actual delivery date ===
    let deliveredAt: Date | null = null;
    const shipment = order.shipments[0];
    if (shipment?.trackingNumber) {
      deliveredAt = await this.sendcloud.getDeliveryDate(order.orderNumber);
    }
    if (deliveredAt && deliveredAt.getTime() > Date.now()) {
      deliveredAt = null;
    }
    // fallback: use preparedAt or orderedAt
    const referenceDate = deliveredAt ?? order.preparedAt ?? order.orderedAt;
    const daysSince = (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
    const effectiveWindow = config.windowDays + exceptions.extendDays;
    const windowExpired = !exceptions.acceptExpired && daysSince > effectiveWindow;
    const effectiveLabelFee = exceptions.freeLabel ? 0 : config.labelPrice;

    // Build returnable items
    const returnedQtyMap: Record<string, number> = {};
    for (const ret of order.returns) {
      for (const ri of ret.items) {
        returnedQtyMap[ri.orderItemId] = (returnedQtyMap[ri.orderItemId] ?? 0) + ri.quantity;
      }
    }

    const returnableItems = order.items
      .map((item) => {
        const alreadyReturned = returnedQtyMap[item.id] ?? 0;
        const returnableQty = item.quantity - alreadyReturned;
        return {
          id: item.id,
          sku: item.sku,
          title: item.title,
          variantTitle: item.variantTitle,
          quantity: item.quantity,
          returnableQuantity: returnableQty,
          imageUrl: item.imageUrl,
          color: item.color,
          size: item.size,
          unitPrice: item.unitPrice
        };
      })
      .filter((item) => item.returnableQuantity > 0);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      shippingAddressJson: order.shippingAddressJson,
      deliveredAt: deliveredAt?.toISOString() ?? null,
      referenceDate: referenceDate.toISOString(),
      daysSince: Math.floor(daysSince),
      windowDays: effectiveWindow,
      windowExpired,
      labelFee: effectiveLabelFee,
      hasException: exceptions.extendDays > 0 || exceptions.freeLabel || exceptions.acceptExpired,
      items: returnableItems,
      reasons: RETURN_REASONS
    };
  }

  async createReturn(dto: CreateReturnDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Debes seleccionar al menos un artículo.');
    }

    // Validate reasons + types
    for (const item of dto.items) {
      if (!VALID_REASONS.includes(item.reason)) {
        throw new BadRequestException(`Motivo inválido: ${item.reason}`);
      }
    }

    const type = (dto.type ?? 'RETURN').toUpperCase();
    if (!VALID_TYPES.includes(type)) {
      throw new BadRequestException(`Tipo inválido: ${dto.type}`);
    }

    // Re-lookup (and apply 15-day check)
    const lookup = await this.lookupOrder({ orderNumber: dto.orderNumber, email: dto.email });
    if (lookup.windowExpired) {
      throw new BadRequestException(`Ha pasado el plazo de ${lookup.windowDays} días desde la entrega. No es posible realizar la devolución.`);
    }

    // Validate items
    const lookupMap = new Map(lookup.items.map((i) => [i.id, i]));
    console.log('[createReturn] lookupMap keys:', [...lookupMap.keys()]);
    console.log('[createReturn] dto.items orderItemIds:', dto.items.map((i) => i.orderItemId));
    for (const reqItem of dto.items) {
      const found = lookupMap.get(reqItem.orderItemId);
      if (!found) {
        throw new BadRequestException(`Artículo ${reqItem.orderItemId} no pertenece a este pedido o ya fue devuelto.`);
      }
      if (reqItem.quantity <= 0 || reqItem.quantity > found.returnableQuantity) {
        throw new BadRequestException(`Cantidad inválida para ${found.title}. Máximo: ${found.returnableQuantity}.`);
      }
      if (type === 'EXCHANGE' && !reqItem.replacementVariantId) {
        throw new BadRequestException(`En cambios necesitas elegir variante de reemplazo para "${found.title}".`);
      }
    }

    const order = await this.prisma.order.findFirstOrThrow({ where: { orderNumber: lookup.orderNumber } });

    // === Calculate amounts ===
    const refundAmount = dto.items.reduce((sum, it) => {
      const itm = lookupMap.get(it.orderItemId);
      return sum + (itm?.unitPrice ?? 0) * it.quantity;
    }, 0);

    let chargeAmount = 0;
    const replacementsInfo: Array<{ variantId: string; productId?: string; title: string; price: number; imageUrl?: string; quantity: number }> = [];

    if (type === 'EXCHANGE') {
      for (const reqItem of dto.items) {
        chargeAmount += (reqItem.replacementPrice ?? 0) * reqItem.quantity;
        replacementsInfo.push({
          variantId: reqItem.replacementVariantId!,
          productId: reqItem.replacementProductId,
          title: reqItem.replacementTitle ?? 'Producto sustitución',
          price: reqItem.replacementPrice ?? 0,
          imageUrl: reqItem.replacementImageUrl,
          quantity: reqItem.quantity
        });
      }
    }

    const labelFee = lookup.labelFee;
    const netDiff = type === 'EXCHANGE' ? chargeAmount - refundAmount : 0;
    const totalToPay = type === 'EXCHANGE'
      ? Math.max(0, netDiff) + labelFee
      : labelFee;

    // === Create Shopify Draft Order (only if there's something to charge) ===
    let draftOrderId: string | null = null;
    let checkoutUrl: string | null = null;

    if (totalToPay > 0) {
      try {
        const lineItems: Array<{ variantId?: string; title?: string; price?: number; quantity: number }> = [];

        if (type === 'EXCHANGE') {
          for (const repl of replacementsInfo) {
            lineItems.push({ variantId: repl.variantId, quantity: repl.quantity });
          }
        }

        if (labelFee > 0) {
          lineItems.push({
            title: type === 'EXCHANGE' ? 'Etiqueta cambio Correos' : 'Etiqueta devolución Correos',
            price: labelFee,
            quantity: 1
          });
        }

        // Credit for the returned items: without this the customer pays the
        // replacement products at full price again (they already paid them in
        // the original order). Discount = value of returned items, capped at
        // the replacements' value, so draft total === totalToPay.
        const exchangeCredit = type === 'EXCHANGE' ? Math.min(refundAmount, chargeAmount) : 0;

        const draft = await this.shopify.createDraftOrder({
          customerEmail: dto.email.toLowerCase().trim(),
          note: `${type === 'EXCHANGE' ? 'CAMBIO' : 'DEVOLUCIÓN'} pedido ${order.orderNumber} — ${dto.items.length} artículo(s)`,
          tags: ['return-portal', type.toLowerCase()],
          shippingAddress: this.shippingAddressFromOrder(order.shippingAddressJson, order.customerName),
          lineItems,
          ...(exchangeCredit > 0 ? { appliedDiscount: {
            valueType: 'FIXED_AMOUNT' as const,
            value: Number(exchangeCredit.toFixed(2)),
            title: 'Crédito artículos devueltos',
            description: `Cambio pedido ${order.orderNumber}`
          } } : {})
        });

        // Safety net: if the draft total still doesn't match what we computed,
        // abort instead of overcharging the customer.
        if (Math.abs(draft.totalPrice - totalToPay) > 0.05) {
          console.error(`[ReturnsService] Draft total mismatch: draft=${draft.totalPrice} expected=${totalToPay} (order ${order.orderNumber})`);
          throw new Error(`El importe calculado no coincide (${draft.totalPrice}€ vs ${totalToPay.toFixed(2)}€). Contacta con soporte.`);
        }

        draftOrderId = draft.id;
        checkoutUrl = draft.invoiceUrl;
      } catch (error) {
        console.error('[ReturnsService] Shopify draft order error:', error);
        throw new BadRequestException(`Error creando orden de pago: ${error instanceof Error ? error.message : 'desconocido'}`);
      }
    }

    // === If no payment needed, generate label directly ===
    let initialStatus = 'REQUESTED';
    let initialPaymentStatus = 'PENDING';
    let sendcloudParcelId: string | null = null;
    let sendcloudTracking: string | null = null;
    let sendcloudCarrier: string | null = null;
    let exchangeOrderName: string | null = null;
    let exchangeOrderUrl: string | null = null;

    // === Free/even EXCHANGE: create a real $0 order for the replacement product so the warehouse can fulfil it ===
    if (totalToPay === 0 && type === 'EXCHANGE' && replacementsInfo.length > 0) {
      try {
        const draft = await this.shopify.createDraftOrder({
          customerEmail: dto.email.toLowerCase().trim(),
          note: `CAMBIO (sin coste) pedido ${order.orderNumber} — ${dto.items.length} artículo(s)`,
          tags: ['return-portal', 'exchange', 'exchange-free'],
          shippingAddress: this.shippingAddressFromOrder(order.shippingAddressJson, order.customerName),
          lineItems: replacementsInfo.map((repl) => ({ variantId: repl.variantId, quantity: repl.quantity })),
          appliedDiscount: { valueType: 'PERCENTAGE', value: 100, title: 'Cambio sin coste', description: `Cambio pedido ${order.orderNumber}` }
        });
        draftOrderId = draft.id;
        const completed = await this.shopify.completeDraftOrder(draft.id);
        exchangeOrderName = completed.orderName;
        exchangeOrderUrl = (completed as { adminUrl?: string | null }).adminUrl ?? null;
        console.log(`[ReturnsService] Free exchange order created: ${completed.orderName ?? completed.orderId ?? 'unknown'}`);
      } catch (error) {
        console.error('[ReturnsService] Free exchange order creation error:', error);
      }
    }

    if (totalToPay === 0) {
      try {
        const sc = await this.sendcloud.createReturn({
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail ?? dto.email,
          customerAddressJson: order.shippingAddressJson,
          returnType: type
        });
        sendcloudParcelId = sc.parcelId || sc.returnId || null;
        sendcloudTracking = sc.trackingNumber ?? null;
        sendcloudCarrier = sc.carrier ?? null;
        if (sendcloudParcelId) {
          initialStatus = 'LABEL_CREATED';
          initialPaymentStatus = 'PAID';
        }
      } catch (error) {
        console.error('[ReturnsService] SendCloud error (free label):', error);
      }
    }

    // === Save Return record ===
    const returnRecord = await this.prisma.return.create({
      data: {
        orderId: order.id,
        shopifyOrderNumber: order.orderNumber,
        customerEmail: dto.email.toLowerCase().trim(),
        customerName: order.customerName,
        type: type as never,
        status: initialStatus as never,
        paymentStatus: initialPaymentStatus as never,
        notes: dto.notes,
        shopifyDraftOrderId: draftOrderId,
        checkoutUrl,
        refundAmount,
        chargeAmount: type === 'EXCHANGE' ? chargeAmount : 0,
        labelFee,
        totalAmount: totalToPay,
        deliveredAt: lookup.deliveredAt ? new Date(lookup.deliveredAt) : null,
        sendcloudReturnId: sendcloudParcelId,
        trackingNumber: sendcloudTracking,
        carrier: sendcloudCarrier,
        exchangeOrderName,
        exchangeOrderUrl,
        paidAt: totalToPay === 0 ? new Date() : null,
        items: {
          create: dto.items.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
            reason: item.reason as never,
            notes: item.notes,
            replacementVariantId: item.replacementVariantId,
            replacementProductId: item.replacementProductId,
            replacementTitle: item.replacementTitle,
            replacementImageUrl: item.replacementImageUrl,
            replacementPrice: item.replacementPrice
          }))
        }
      },
      include: { items: { include: { orderItem: true } } }
    });

    await this.activity.log({
      entityType: 'Return',
      entityId: returnRecord.id,
      action: 'RETURN_CREATED',
      message: `${type === 'EXCHANGE' ? 'Cambio' : 'Devolución'} para ${order.orderNumber} — ${dto.items.length} artículo(s) — total a pagar: ${totalToPay.toFixed(2)}€`,
      metadataJson: { type, totalAmount: totalToPay, draftOrderId }
    });

    // Klaviyo: send label email if label was generated immediately (free return)
    if (returnRecord.status === 'LABEL_CREATED' && returnRecord.sendcloudReturnId) {
      this.klaviyo.trackLabelCreated({
        email: returnRecord.customerEmail,
        customerName: returnRecord.customerName,
        orderNumber: returnRecord.shopifyOrderNumber,
        trackingNumber: returnRecord.trackingNumber,
        carrier: returnRecord.carrier,
        labelUrl: `${process.env.API_URL ?? ''}/returns/${returnRecord.id}/label`
      }).catch((err) => console.error('[ReturnsService] Klaviyo label email error:', err));
    }

    return {
      returnId: returnRecord.id,
      type,
      status: returnRecord.status,
      paymentStatus: returnRecord.paymentStatus,
      labelUrl: returnRecord.sendcloudReturnId ? `/returns/${returnRecord.id}/label` : null,
      refundAmount: returnRecord.refundAmount,
      chargeAmount: returnRecord.chargeAmount,
      labelFee: returnRecord.labelFee,
      totalAmount: returnRecord.totalAmount,
      checkoutUrl: returnRecord.checkoutUrl,
      items: returnRecord.items.map((ri) => ({
        title: ri.orderItem.title,
        variantTitle: ri.orderItem.variantTitle,
        quantity: ri.quantity,
        reason: RETURN_REASONS[ri.reason] ?? ri.reason,
        replacementTitle: ri.replacementTitle,
        replacementPrice: ri.replacementPrice
      }))
    };
  }

  /** Called when Shopify draft order is paid (webhook) */
  async markPaidAndGenerateLabel(identifier: { type: 'draftOrderId'; value: string } | { type: 'orderNumber'; value: string }) {
    const where =
      identifier.type === 'draftOrderId'
        ? { shopifyDraftOrderId: identifier.value, paymentStatus: 'PENDING' as const }
        : { shopifyOrderNumber: { contains: identifier.value.replace(/^#/, '') }, paymentStatus: 'PENDING' as const };

    const returnRecord = await this.prisma.return.findFirst({ where });
    if (!returnRecord) {
      console.log(`[ReturnsService] No pending return found for`, identifier);
      return null;
    }

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: returnRecord.orderId } });

    let sendcloudResult: { returnId: string; parcelId?: string; trackingNumber?: string; carrier?: string } = { returnId: '' };
    try {
      sendcloudResult = await this.sendcloud.createReturn({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail ?? returnRecord.customerEmail,
        customerAddressJson: order.shippingAddressJson,
        returnType: returnRecord.type
      });
    } catch (error) {
      console.error('[ReturnsService] SendCloud error after payment:', error);
    }

    const updated = await this.prisma.return.update({
      where: { id: returnRecord.id },
      data: {
        paymentStatus: 'PAID',
        paidAt: new Date(),
        status: sendcloudResult.parcelId ? 'LABEL_CREATED' : 'REQUESTED',
        sendcloudReturnId: sendcloudResult.parcelId || sendcloudResult.returnId || null,
        trackingNumber: sendcloudResult.trackingNumber ?? null,
        carrier: sendcloudResult.carrier ?? null
      }
    });

    await this.activity.log({
      entityType: 'Return',
      entityId: returnRecord.id,
      action: 'PAYMENT_CONFIRMED',
      message: `Pago confirmado para ${returnRecord.shopifyOrderNumber} — etiqueta ${sendcloudResult.parcelId ? 'generada' : 'pendiente'}`,
      metadataJson: { identifier, parcelId: sendcloudResult.parcelId }
    });

    // Klaviyo: label email after payment confirmed
    if (sendcloudResult.parcelId) {
      this.klaviyo.trackLabelCreated({
        email: returnRecord.customerEmail,
        customerName: returnRecord.customerName,
        orderNumber: returnRecord.shopifyOrderNumber,
        trackingNumber: sendcloudResult.trackingNumber,
        carrier: sendcloudResult.carrier,
        labelUrl: `${process.env.API_URL ?? ''}/returns/${returnRecord.id}/label`
      }).catch((err) => console.error('[ReturnsService] Klaviyo label email error (paid):', err));
    }

    return updated;
  }

  /** Admin: manually generate SendCloud label + send Klaviyo email */
  async generateLabelForReturn(id: string) {
    const returnRecord = await this.prisma.return.findUnique({
      where: { id },
      include: { order: true }
    });
    if (!returnRecord) throw new NotFoundException('Devolución no encontrada.');

    const order = returnRecord.order;
    let sendcloudResult: { returnId: string; parcelId?: string; trackingNumber?: string; carrier?: string } = { returnId: '' };
    try {
      sendcloudResult = await this.sendcloud.createReturn({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail ?? returnRecord.customerEmail,
        customerAddressJson: order.shippingAddressJson,
        returnType: returnRecord.type
      });
    } catch (error) {
      console.error('[ReturnsService] generateLabelForReturn SendCloud error:', error);
      throw new BadRequestException(`Error creando etiqueta en SendCloud: ${error instanceof Error ? error.message : 'desconocido'}`);
    }

    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        status: sendcloudResult.parcelId ? 'LABEL_CREATED' : returnRecord.status,
        paymentStatus: returnRecord.paymentStatus === 'PENDING' ? 'PAID' : returnRecord.paymentStatus,
        sendcloudReturnId: sendcloudResult.parcelId || sendcloudResult.returnId || null,
        trackingNumber: sendcloudResult.trackingNumber ?? null,
        carrier: sendcloudResult.carrier ?? null
      }
    });

    if (sendcloudResult.parcelId) {
      this.klaviyo.trackLabelCreated({
        email: returnRecord.customerEmail,
        customerName: returnRecord.customerName,
        orderNumber: returnRecord.shopifyOrderNumber,
        trackingNumber: sendcloudResult.trackingNumber,
        carrier: sendcloudResult.carrier,
        labelUrl: `${process.env.API_URL ?? ''}/returns/${id}/label`
      }).catch((err) => console.error('[ReturnsService] Klaviyo generateLabel error:', err));
    }

    return { success: true, status: updated.status, trackingNumber: updated.trackingNumber, parcelId: sendcloudResult.parcelId };
  }

  /** Admin: manually create a real Shopify order for the replacement products of an EXCHANGE. */
  async createExchangeOrder(id: string) {
    const returnRecord = await this.prisma.return.findUnique({
      where: { id },
      include: { order: true, items: true }
    });
    if (!returnRecord) throw new NotFoundException('Devolución no encontrada.');
    if (returnRecord.type !== 'EXCHANGE') {
      throw new BadRequestException('Solo los cambios pueden generar pedido de reemplazo.');
    }
    if (returnRecord.shopifyDraftOrderId) {
      throw new BadRequestException('Este cambio ya tiene un pedido de reemplazo creado en Shopify.');
    }

    const lineItems = returnRecord.items
      .filter((it) => it.replacementVariantId)
      .map((it) => ({ variantId: it.replacementVariantId!, quantity: it.quantity }));

    if (lineItems.length === 0) {
      throw new BadRequestException('Este cambio no tiene variantes de reemplazo asignadas.');
    }

    let draftId: string;
    let orderName: string | null = null;
    let adminUrl: string | null = null;
    try {
      const draft = await this.shopify.createDraftOrder({
        customerEmail: returnRecord.customerEmail,
        note: `CAMBIO (manual admin) pedido ${returnRecord.shopifyOrderNumber} — ${lineItems.length} artículo(s)`,
        tags: ['return-portal', 'exchange', 'exchange-manual'],
        shippingAddress: this.shippingAddressFromOrder(returnRecord.order.shippingAddressJson, returnRecord.customerName),
        lineItems,
        appliedDiscount: { valueType: 'PERCENTAGE', value: 100, title: 'Cambio sin coste', description: `Cambio pedido ${returnRecord.shopifyOrderNumber}` }
      });
      draftId = draft.id;
      const completed = await this.shopify.completeDraftOrder(draft.id);
      orderName = completed.orderName;
      adminUrl = completed.adminUrl;
    } catch (error) {
      throw new BadRequestException(`Error creando pedido en Shopify: ${error instanceof Error ? error.message : 'desconocido'}`);
    }

    await this.prisma.return.update({ where: { id }, data: { shopifyDraftOrderId: draftId, exchangeOrderName: orderName, exchangeOrderUrl: adminUrl } });
    await this.activity.log({
      entityType: 'Return',
      entityId: id,
      action: 'EXCHANGE_ORDER_CREATED',
      message: `Pedido de reemplazo ${orderName ?? ''} creado en Shopify para ${returnRecord.shopifyOrderNumber}`.trim(),
      metadataJson: { draftOrderId: draftId, orderName }
    });

    return { success: true, orderName, orderUrl: adminUrl, draftOrderId: draftId };
  }

  async getReturnStatus(id: string) {
    const record = await this.prisma.return.findUnique({
      where: { id },
      include: { items: { include: { orderItem: true } } }
    });
    if (!record) throw new NotFoundException('Devolución no encontrada');
    return {
      returnId: record.id,
      type: record.type,
      status: record.status,
      paymentStatus: record.paymentStatus,
      checkoutUrl: record.checkoutUrl,
      labelUrl: record.sendcloudReturnId ? `/returns/${record.id}/label` : null,
      trackingNumber: record.trackingNumber,
      carrier: record.carrier,
      totalAmount: record.totalAmount,
      paidAt: record.paidAt,
      items: record.items.map((ri) => ({
        title: ri.orderItem.title,
        variantTitle: ri.orderItem.variantTitle,
        quantity: ri.quantity,
        reason: RETURN_REASONS[ri.reason] ?? ri.reason,
        replacementTitle: ri.replacementTitle
      }))
    };
  }

  async downloadLabel(returnId: string): Promise<Buffer> {
    const record = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!record) throw new NotFoundException('Devolución no encontrada');
    if (!record.sendcloudReturnId) {
      throw new BadRequestException('Etiqueta aún no generada. ¿Pago confirmado?');
    }
    return this.sendcloud.downloadReturnLabel(record.sendcloudReturnId);
  }

  async findAll() {
    return this.prisma.return.findMany({
      include: {
        order: { select: { orderNumber: true, customerName: true, customerEmail: true } },
        items: { include: { orderItem: { select: { title: true, variantTitle: true, sku: true, imageUrl: true } } } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.return.findUnique({
      where: { id },
      include: { order: true, items: { include: { orderItem: true } } }
    });
    if (!record) throw new NotFoundException(`Devolución ${id} no encontrada`);
    return record;
  }

  async findByTracking(tracking: string) {
    const clean = (tracking ?? '').trim();
    const include = { order: true, items: { include: { orderItem: true } } } as const;

    // 1) Exact match (case-insensitive) — fast path.
    let record = await this.prisma.return.findFirst({
      where: { trackingNumber: { equals: clean, mode: 'insensitive' } },
      include
    });

    // 2) Tolerant match: scanned barcodes often carry spaces, prefixes or
    //    suffixes that differ from the stored tracking. Normalise to
    //    alphanumerics and compare, allowing one to contain the other.
    if (!record) {
      const norm = (s: string) => (s ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
      const scanned = norm(clean);
      if (scanned.length >= 6) {
        const candidates = await this.prisma.return.findMany({
          where: { trackingNumber: { not: null } },
          include,
          orderBy: { createdAt: 'desc' },
          take: 500
        });
        record = candidates.find((r) => {
          const stored = norm(r.trackingNumber ?? '');
          if (!stored) return false;
          return stored === scanned || stored.includes(scanned) || scanned.includes(stored);
        }) ?? null;
      }
    }

    if (!record) {
      console.warn(`[ReturnsService] findByTracking miss — scanned="${clean}"`);
      throw new NotFoundException(`No se encontró devolución con tracking ${clean}`);
    }
    return record;
  }

  async updateStatus(id: string, status: string) {
    const validStatuses = ['REQUESTED', 'LABEL_CREATED', 'RECEIVED', 'APPROVED', 'REJECTED', 'CANCELLED'];
    if (!validStatuses.includes(status)) throw new BadRequestException(`Estado inválido: ${status}`);
    const record = await this.prisma.return.update({ where: { id }, data: { status: status as never } });
    await this.activity.log({
      entityType: 'Return',
      entityId: id,
      action: 'RETURN_STATUS_UPDATED',
      message: `Estado de ${record.shopifyOrderNumber} actualizado a ${status}`,
      metadataJson: { status }
    });

    // Feature 1: Automatic Shopify refund when approved.
    // RETURN only — exchanges already received the returned-items credit as a
    // discount on the replacement order; refunding here would pay them twice.
    if (status === 'APPROVED' && record.type === 'RETURN') {
      this.issueShopifyRefund(id).catch((err) => {
        console.error('[ReturnsService] Background Shopify refund error:', err);
      });

      // Klaviyo: fire immediately on approval (regardless of refund outcome)
      const approvedAt = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      const fullRecord = await this.prisma.return.findUnique({ where: { id }, include: { items: { include: { orderItem: true } } } });
      if (fullRecord) {
        const total = fullRecord.items.reduce((sum, i) => sum + (i.orderItem.unitPrice ?? 0) * i.quantity, 0);
        this.klaviyo.trackRefundApproved({
          email: fullRecord.customerEmail,
          customerName: fullRecord.customerName,
          orderNumber: fullRecord.shopifyOrderNumber,
          refundAmount: total,
          approvedAt
        }).catch((err) => console.error('[ReturnsService] Klaviyo approved email error:', err));
      }
    }

    return record;
  }

  /** Attempts to issue a Shopify refund. Non-blocking — errors are logged, not thrown. */
  private async issueShopifyRefund(id: string) {
    try {
      const ret = await this.prisma.return.findUnique({
        where: { id },
        include: {
          order: true,
          items: { include: { orderItem: true } }
        }
      });
      if (!ret) return;

      const shopifyOrderId = ret.order.shopifyOrderId;
      if (!shopifyOrderId) {
        console.log(`[ReturnsService] No shopifyOrderId for return ${id}, skipping refund`);
        return;
      }

      // Build refund line items using shopifyLineItemId
      const refundLineItems = ret.items
        .filter((item) => item.orderItem.shopifyLineItemId)
        .map((item) => {
          const rawId = item.orderItem.shopifyLineItemId!;
          const numericId = rawId.includes('/') ? rawId.split('/').pop() : rawId;
          return {
            line_item_id: Number(numericId),
            quantity: item.quantity,
            restock_type: 'no_restock' as const
          };
        });

      if (refundLineItems.length === 0) {
        console.log(`[ReturnsService] No Shopify line item IDs for return ${id}, skipping refund`);
        return;
      }

      // Calculate total refund amount
      const total = ret.items.reduce((sum, item) => {
        return sum + (item.orderItem.unitPrice ?? 0) * item.quantity;
      }, 0);

      // Extract numeric Shopify order ID
      const numericOrderId = shopifyOrderId.includes('/')
        ? shopifyOrderId.split('/').pop()
        : shopifyOrderId;

      // Fetch parent transaction to build the transactions array (required for manual/gateway refunds)
      let transactions: Array<{ parent_id: number; amount: string; kind: string; gateway: string }> = [];
      try {
        const txns = await this.shopify.getOrderTransactions(numericOrderId!);
        const saleTxn = txns.find((t) => t.kind === 'sale' && t.status === 'success');
        if (saleTxn) {
          transactions = [{ parent_id: saleTxn.id, amount: total.toFixed(2), kind: 'refund', gateway: saleTxn.gateway }];
        }
      } catch (txnErr) {
        console.warn(`[ReturnsService] Could not fetch transactions for order ${numericOrderId}:`, txnErr);
      }

      const response = await this.shopify.createRefund(numericOrderId!, {
        notify: true,
        note: 'Devolución aprobada desde portal de devoluciones',
        refund_line_items: refundLineItems,
        ...(transactions.length > 0 && { transactions })
      });

      const refundedAt = new Date();
      await this.prisma.return.update({
        where: { id },
        data: {
          refundedAt,
          refundId: String(response.refund.id),
          shopifyRefundAmount: total
        }
      });

      console.log(`[ReturnsService] Shopify refund ${response.refund.id} issued for return ${id}`);
    } catch (err) {
      console.error(`[ReturnsService] Failed to issue Shopify refund for return ${id}:`, err);
    }
  }

  async uploadPhoto(id: string, data: string) {
    if (!data.startsWith('data:image/')) {
      throw new BadRequestException('El dato debe ser una imagen en formato data URL (data:image/...)');
    }
    const ret = await this.prisma.return.findUnique({ where: { id } });
    if (!ret) throw new NotFoundException(`Devolución ${id} no encontrada`);
    return this.prisma.returnPhoto.create({ data: { returnId: id, data } });
  }

  async getPhotos(id: string) {
    return this.prisma.returnPhoto.findMany({
      where: { returnId: id },
      orderBy: { createdAt: 'asc' }
    });
  }

  async verifyReturn(id: string, data: { verificationStatus: 'OK' | 'ISSUE'; verificationNotes?: string }) {
    const record = await this.prisma.return.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Devolución ${id} no encontrada`);

    const newStatus = data.verificationStatus === 'OK' ? 'APPROVED' : 'REJECTED';

    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        verificationStatus: data.verificationStatus,
        verificationNotes: data.verificationNotes,
        verifiedAt: new Date(),
        receivedAt: record.receivedAt ?? new Date(),
        status: newStatus as never
      }
    });

    await this.activity.log({
      entityType: 'Return',
      entityId: id,
      action: 'RETURN_VERIFIED',
      message: `Verificación ${data.verificationStatus} para ${record.shopifyOrderNumber}${data.verificationNotes ? ': ' + data.verificationNotes : ''}`,
      metadataJson: { verificationStatus: data.verificationStatus }
    });

    return updated;
  }

  async markReceived(id: string) {
    const record = await this.prisma.return.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Devolución ${id} no encontrada`);
    const receivedAt = new Date();
    const updated = await this.prisma.return.update({
      where: { id },
      data: { receivedAt, status: 'RECEIVED' as never }
    });

    // Klaviyo: package received email
    this.klaviyo.trackPackageReceived({
      email: record.customerEmail,
      customerName: record.customerName,
      orderNumber: record.shopifyOrderNumber,
      receivedAt: receivedAt.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
    }).catch((err) => console.error('[ReturnsService] Klaviyo received email error:', err));

    return updated;
  }

  private shippingAddressFromOrder(shippingAddressJson: unknown, fallbackName: string) {
    if (!shippingAddressJson || typeof shippingAddressJson !== 'object') return undefined;
    const src = shippingAddressJson as Record<string, string | undefined>;
    const [firstName, ...rest] = (src.name ?? fallbackName).split(' ');
    return {
      firstName,
      lastName: rest.join(' '),
      address1: src.address1,
      address2: src.address2,
      city: src.city,
      province: src.province,
      zip: src.zip,
      countryCode: src.countryCodeV2 ?? src.country_code ?? 'ES',
      phone: src.phone
    };
  }
}
