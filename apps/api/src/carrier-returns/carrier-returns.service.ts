import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KlaviyoService } from '../klaviyo/klaviyo.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyAdapter } from '../shopify/shopify.adapter';

type Reason = 'ABSENT' | 'NO_ATTEND' | 'WRONG_ADDRESS' | 'REFUSED' | 'OTHER';

@Injectable()
export class CarrierReturnsService {
  private readonly logger = new Logger(CarrierReturnsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyAdapter,
    private readonly klaviyo: KlaviyoService,
    private readonly config: ConfigService
  ) {}

  private get fee(): number {
    const raw = Number((this.config.get<string>('CARRIER_RETURN_FEE') ?? '').replace(',', '.'));
    return Number.isFinite(raw) && raw > 0 ? raw : 4.95;
  }

  list(status?: string) {
    return this.prisma.carrierReturn.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' }
    });
  }

  async stats() {
    const grouped = await this.prisma.carrierReturn.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(grouped.map((g) => [g.status, g._count]));
  }

  /** Register a returned-to-sender order. Pulls customer/email from our DB order if it exists. */
  async create(input: { orderNumber: string; reason?: Reason; notes?: string }) {
    const orderNumber = input.orderNumber?.trim();
    if (!orderNumber) throw new BadRequestException('Número de pedido requerido');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ orderNumber }, { orderNumber: `#${orderNumber.replace(/^#/, '')}` }] }
    });
    const created = await this.prisma.carrierReturn.create({
      data: {
        orderId: order?.id ?? null,
        orderNumber: order?.orderNumber ?? orderNumber,
        customerName: order?.customerName ?? null,
        customerEmail: order?.customerEmail ?? null,
        reason: (input.reason ?? 'OTHER') as any,
        feeAmount: this.fee,
        notes: input.notes?.trim() || null
      }
    });
    await this.ensureEmail(created);
    return this.prisma.carrierReturn.findUnique({ where: { id: created.id } });
  }

  /** Find an order by its tracking/parcel id (Shipment in our DB) and register the carrier return. */
  async createFromTracking(input: { tracking: string; reason?: Reason }) {
    const t = input.tracking?.trim();
    if (!t) throw new BadRequestException('Tracking requerido');
    const shipment = await this.prisma.shipment.findFirst({
      where: { OR: [{ trackingNumber: t }, { sendcloudParcelId: t }, { trackingNumber: { contains: t } }] },
      include: { order: true },
      orderBy: { createdAt: 'desc' }
    });
    if (!shipment?.order) {
      throw new NotFoundException(`No encontré ningún pedido con el tracking ${t}. Métele el nº de pedido a mano.`);
    }
    const order = shipment.order;
    const existing = await this.prisma.carrierReturn.findFirst({
      where: { orderNumber: order.orderNumber, status: { notIn: ['RESHIPPED', 'CANCELLED'] } }
    });
    if (existing) return { detected: true, alreadyExists: true, carrierReturn: existing };
    const created = await this.prisma.carrierReturn.create({
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        reason: (input.reason ?? 'OTHER') as any,
        feeAmount: this.fee
      }
    });
    await this.ensureEmail(created);
    const fresh = await this.prisma.carrierReturn.findUnique({ where: { id: created.id } });
    return { detected: true, alreadyExists: false, carrierReturn: fresh };
  }

  async update(id: string, input: { status?: string; customerEmail?: string; reason?: Reason; notes?: string; newAddress?: string }) {
    await this.get(id);
    const data: any = {};
    if (input.status) data.status = input.status;
    if (input.customerEmail !== undefined) data.customerEmail = input.customerEmail?.trim() || null;
    if (input.reason) data.reason = input.reason;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.newAddress !== undefined) data.newAddress = input.newAddress?.trim() || null;
    if (input.status === 'PAID') data.paidAt = new Date();
    if (input.status === 'RESHIPPED') data.reshippedAt = new Date();
    return this.prisma.carrierReturn.update({ where: { id }, data });
  }

  private async get(id: string) {
    const r = await this.prisma.carrierReturn.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Devolución no encontrada');
    return r;
  }

  /** Backfill customer email/name from Shopify when our DB order lacked it. */
  private async ensureEmail(ret: { id: string; orderNumber: string; customerEmail: string | null; customerName: string | null }) {
    if (ret.customerEmail || !this.shopify.hasCredentials()) return ret.customerEmail;
    try {
      const o = await this.shopify.fetchOrderByName(ret.orderNumber);
      if (o?.customerEmail) {
        await this.prisma.carrierReturn.update({
          where: { id: ret.id },
          data: { customerEmail: o.customerEmail, customerName: ret.customerName ?? o.customerName ?? null }
        });
        ret.customerEmail = o.customerEmail;
        return o.customerEmail;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Create a Shopify checkout link for the reship fee (also collects the corrected address) + email the customer. */
  async requestPayment(id: string) {
    const ret = await this.get(id);
    await this.ensureEmail(ret);
    if (!ret.customerEmail) throw new BadRequestException('Falta el email del cliente. Añádelo antes de pedir el pago.');

    let invoiceUrl = ret.invoiceUrl;
    let draftOrderId = ret.draftOrderId;
    if (this.shopify.hasCredentials()) {
      const draft = await this.shopify.createDraftOrder({
        customerEmail: ret.customerEmail,
        note: `🔁 ENVÍO NUEVO del pedido ${ret.orderNumber} — devuelto por Correos. Reenviar a la dirección de ESTE pedido.`,
        tags: ['reenvio', 'correos-devuelto', `reenvio-${ret.orderNumber.replace(/^#/, '')}`],
        noteAttributes: [
          { key: 'Reenvío del pedido', value: ret.orderNumber },
          { key: 'Motivo', value: ret.reason }
        ],
        lineItems: [{ title: `Reenvío del pedido ${ret.orderNumber} (devuelto por Correos)`, price: ret.feeAmount, quantity: 1 }]
      });
      invoiceUrl = draft.invoiceUrl;
      draftOrderId = draft.id;
      // Email channel: 'klaviyo' (flow) by default, or 'shopify' to send Shopify's transactional invoice.
      const channel = (this.config.get<string>('CARRIER_RETURN_SEND_VIA') ?? 'klaviyo').toLowerCase();
      if (channel === 'shopify') {
        try {
          await this.shopify.sendDraftOrderInvoice(
            draft.id,
            `Correos nos devolvió tu pedido ${ret.orderNumber}. Para reenviártelo, paga el reenvío (${ret.feeAmount.toFixed(2)} €) y confirma tu dirección en este enlace. ¡Gracias!`
          );
        } catch (e) {
          this.logger.warn(`Shopify invoice email failed ${ret.orderNumber}: ${(e as Error).message}`);
        }
      }
    }

    await this.klaviyo.trackCarrierReturn({
      email: ret.customerEmail,
      customerName: ret.customerName ?? 'Hola',
      orderNumber: ret.orderNumber,
      fee: ret.feeAmount,
      payUrl: invoiceUrl ?? ''
    }).catch(() => undefined);

    return this.prisma.carrierReturn.update({
      where: { id },
      data: { invoiceUrl, draftOrderId, status: 'EMAILED', emailedAt: new Date() }
    });
  }
}
