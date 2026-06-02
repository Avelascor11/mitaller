import { Injectable, Logger } from '@nestjs/common';
import { OrderItem, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ActivityService } from '../activity/activity.service';
import { PriorityService } from '../priority/priority.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyAdapter } from '../shopify/shopify.adapter';
import { OrderTaskFactoryService } from './order-task-factory.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly priority: PriorityService,
    private readonly shopify: ShopifyAdapter,
    private readonly taskFactory: OrderTaskFactoryService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService
  ) {}

  @Cron('*/2 * * * *')
  async scheduledShopifySync() {
    if (this.isSyncing) return;
    if (!this.shopify.hasCredentials()) return;
    this.isSyncing = true;
    try {
      const result = await this.importShopifyOrders();
      this.logger.log(`Scheduled Shopify sync: ${result.imported} orders`);
    } catch (error) {
      this.logger.warn(`Scheduled Shopify sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isSyncing = false;
    }
  }

  async findAll() {
    const orders = await this.prisma.order.findMany({
      orderBy: [{ priorityLevel: 'asc' }, { internalDeadlineAt: 'asc' }],
      include: { items: this.activeOrderItemsInclude(), shipments: true }
    });
    return this.filterByMinimumOrderNumber(orders.map((order) => this.stripBlobs(order)));
  }

  async findPendingPreparation() {
    const orders = await this.prisma.order.findMany({
      where: {
        operationalStatus: {
          notIn: ['READY_FOR_LABEL', 'LABEL_CREATED', 'SHIPPED', 'CANCELLED']
        }
      },
      orderBy: [{ priorityLevel: 'asc' }, { internalDeadlineAt: 'asc' }, { orderedAt: 'asc' }],
      include: { items: this.activeOrderItemsInclude(), shipments: true }
    });
    return this.filterByMinimumOrderNumber(orders.map((order) => this.stripBlobs(order)));
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findFirstOrThrow({
      where: { OR: [{ id }, { orderNumber: id }, { shopifyOrderId: id }] },
      include: { items: this.activeOrderItemsInclude(), productionTasks: true, shipments: true }
    });
    return this.stripBlobs(order);
  }

  private activeOrderItemsInclude() {
    return {
      where: { status: { not: 'CANCELLED' as const } },
      orderBy: { createdAt: 'asc' as const }
    };
  }

  private stripBlobs<T extends { packagePhoto?: unknown; shipments?: Array<{ packagePhoto?: unknown }> }>(order: T): T {
    if ('packagePhoto' in order) (order as { packagePhoto?: unknown }).packagePhoto = undefined;
    if (Array.isArray(order.shipments)) {
      for (const shipment of order.shipments) {
        if (shipment && 'packagePhoto' in shipment) (shipment as { packagePhoto?: unknown }).packagePhoto = undefined;
      }
    }
    return order;
  }

  async markPrepared(id: string, photoBase64?: string) {
    const existing = await this.findOne(id);
    const photoBytes = this.decodePhoto(photoBase64);
    const photoData = photoBytes
      ? { packagePhoto: Uint8Array.from(photoBytes), packagePhotoAt: new Date() }
      : {};
    const order = await this.prisma.order.update({
      where: { id: existing.id },
      data: {
        operationalStatus: 'READY_FOR_LABEL',
        preparedAt: new Date(),
        ...photoData
      },
      include: { items: this.activeOrderItemsInclude(), shipments: true }
    });
    await this.prisma.productionTask.updateMany({
      where: {
        orderId: existing.id,
        title: { startsWith: 'Preparar pedido' }
      },
      data: { status: 'DONE', completedAt: new Date() }
    });
    await this.decrementStockForPreparation(existing.id);
    await this.activity.log({
      entityType: 'Order',
      entityId: existing.id,
      action: 'ORDER_PREPARED',
      message: `Pedido ${existing.orderNumber} marcado como preparado`
    });
    return order;
  }

  async confirmPicking(id: string) {
    const existing = await this.findOne(id);
    const alreadyPicked = await this.hasActivePreparationStockDeduction(existing.id);
    if (!alreadyPicked) {
      await this.decrementStockForPreparation(existing.id, 'ORDER_STOCK_PICKED');
      await this.activity.log({
        entityType: 'Order',
        entityId: existing.id,
        action: 'ORDER_STOCK_PICKED',
        message: `Ropa base cogida para el pedido ${existing.orderNumber}`
      });
    }

    return this.prisma.order.update({
      where: { id: existing.id },
      data: { operationalStatus: 'IN_PRODUCTION' },
      include: { items: this.activeOrderItemsInclude(), shipments: true }
    });
  }

  async getPackagePhoto(id: string): Promise<Buffer | null> {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }, { shopifyOrderId: id }] },
      select: { packagePhoto: true }
    });
    if (!order?.packagePhoto) return null;
    return Buffer.from(order.packagePhoto as Buffer);
  }

  private decodePhoto(input?: string): Buffer | undefined {
    if (!input) return undefined;
    const stripped = input.replace(/^data:image\/[a-z]+;base64,/i, '');
    try {
      const buffer = Buffer.from(stripped, 'base64');
      if (buffer.length < 200) return undefined;
      return buffer;
    } catch {
      return undefined;
    }
  }

  private async decrementStockForPreparation(orderId: string, reason = 'ORDER_PREPARED') {
    if (await this.hasActivePreparationStockDeduction(orderId)) return;

    const demands = await this.getPreparationStockDemands(orderId);
    for (const demand of demands) {
      const stockItem = await this.prisma.stockItem.findUnique({
        where: { id: demand.stockItemId },
        include: { levels: { orderBy: { quantity: 'desc' } } }
      });
      if (!stockItem) continue;
      let remaining = demand.quantity;
      for (const level of stockItem.levels) {
        if (remaining <= 0) break;
        const take = Math.min(level.quantity, remaining);
        if (take <= 0) continue;
        await this.prisma.stockLevel.update({
          where: { id: level.id },
          data: { quantity: { decrement: take } }
        });
        await this.prisma.stockMovement.create({
          data: {
            stockItemId: stockItem.id,
            fromLocationId: level.locationId,
            quantity: -take,
            reason,
            relatedOrderId: orderId
          }
        });
        remaining -= take;
      }
      if (remaining > 0) {
        await this.activity.log({
          entityType: 'Order',
          entityId: orderId,
          action: 'ORDER_PREPARED_STOCK_SHORT',
          message: `Faltan ${remaining} unidades de ${stockItem.name} para descontar stock`,
          metadataJson: { stockItemId: stockItem.id, sku: stockItem.sku, missingQuantity: remaining }
        });
      }
    }
  }

  private async restoreStockForPreparation(orderId: string) {
    const netMovements = await this.getPreparationStockMovementNet(orderId);
    for (const movement of netMovements) {
      if (movement.quantity >= 0) continue;
      const restoreQuantity = Math.abs(movement.quantity);
      const locationId = movement.locationId ?? (await this.defaultStockLocationId());
      await this.prisma.stockLevel.upsert({
        where: { stockItemId_locationId: { stockItemId: movement.stockItemId, locationId } },
        create: { stockItemId: movement.stockItemId, locationId, quantity: restoreQuantity },
        update: { quantity: { increment: restoreQuantity } }
      });
      await this.prisma.stockMovement.create({
        data: {
          stockItemId: movement.stockItemId,
          toLocationId: locationId,
          quantity: restoreQuantity,
          reason: 'ORDER_PREPARED_REOPENED',
          relatedOrderId: orderId
        }
      });
    }
  }

  private async hasActivePreparationStockDeduction(orderId: string) {
    const total = (await this.getPreparationStockMovementNet(orderId)).reduce((sum, movement) => sum + movement.quantity, 0);
    return total < 0;
  }

  private async getPreparationStockMovementNet(orderId: string) {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        relatedOrderId: orderId,
        reason: { in: ['ORDER_PREPARED', 'ORDER_STOCK_PICKED', 'ORDER_PREPARED_REOPENED'] }
      }
    });
    const grouped = new Map<string, { stockItemId: string; locationId: string | null; quantity: number }>();
    for (const movement of movements) {
      const locationId = movement.fromLocationId ?? movement.toLocationId ?? null;
      const key = `${movement.stockItemId}:${locationId ?? ''}`;
      const current = grouped.get(key) ?? { stockItemId: movement.stockItemId, locationId, quantity: 0 };
      current.quantity += movement.quantity;
      grouped.set(key, current);
    }
    return [...grouped.values()];
  }

  private async getPreparationStockDemands(orderId: string) {
    const [items, mappings, stockItems] = await Promise.all([
      this.prisma.orderItem.findMany({ where: { orderId, status: { not: 'CANCELLED' } } }),
      this.prisma.productSubproductMapping.findMany(),
      this.prisma.stockItem.findMany({ where: { type: 'BLANK_GARMENT' } })
    ]);
    const mappingIndex = this.buildSubproductMappingIndex(mappings);
    const stockIndex = new Map<string, { id: string; sku: string; name: string }>();
    for (const stockItem of stockItems) {
      const mapped = this.mapSubproductName(`${stockItem.name} ${stockItem.sku} ${stockItem.supplierSku ?? ''}`);
      if (mapped) stockIndex.set(this.stockDemandKey(mapped.kind, mapped.color, mapped.size), stockItem);
    }

    const demands = new Map<string, { stockItemId: string; quantity: number }>();
    for (const item of items) {
      const mapped = this.mapOrderItemToBlankGarment(item, mappingIndex);
      if (!mapped) continue;
      const stockItem = stockIndex.get(this.stockDemandKey(mapped.kind, mapped.color, mapped.size));
      if (!stockItem) continue;
      const current = demands.get(stockItem.id) ?? { stockItemId: stockItem.id, quantity: 0 };
      current.quantity += item.quantity;
      demands.set(stockItem.id, current);
    }
    return [...demands.values()];
  }

  private async defaultStockLocationId() {
    const location = await this.prisma.stockLocation.findFirst({
      where: { code: { in: ['EST-A-01', 'TALLER'] } },
      orderBy: { code: 'asc' }
    });
    if (location) return location.id;
    return (await this.prisma.stockLocation.findFirstOrThrow()).id;
  }

  private buildSubproductMappingIndex(mappings: Array<{ sku: string; productName: string; subproductName: string }>) {
    const index = new Map<string, string>();
    for (const mapping of mappings) {
      if (this.isReliableSku(mapping.sku)) index.set(`sku:${mapping.sku}`, mapping.subproductName);
      index.set(`name:${this.normalizeText(mapping.productName)}`, mapping.subproductName);
    }
    return index;
  }

  private mapOrderItemToBlankGarment(
    item: { productType?: string | null; title: string; sku: string; color?: string | null; size?: string | null; variantTitle?: string | null },
    mappingIndex: Map<string, string>
  ) {
    const mappedSubproduct =
      mappingIndex.get(`name:${this.normalizeText(item.title)}`)
      ?? (this.isReliableSku(item.sku) ? mappingIndex.get(`sku:${item.sku}`) : undefined);
    if (mappedSubproduct) {
      const mapped = this.mapSubproductName(mappedSubproduct);
      if (mapped) return mapped;
    }

    const kind = this.inferGarmentKind(`${item.productType ?? ''} ${item.title} ${item.sku}`);
    const color = this.normalizeColor(`${item.color ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    const size = this.normalizeSize(`${item.size ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    if (!kind || !color || !size) return null;
    return { kind, color, size };
  }

  private mapSubproductName(subproductName: string) {
    const kind = this.inferGarmentKind(subproductName);
    const color = this.normalizeColor(subproductName);
    const size = this.normalizeSize(subproductName);
    if (!kind || !color || !size) return null;
    return { kind, color, size };
  }

  private stockDemandKey(kind: string, color: string, size: string) {
    return `${kind}:${color}:${size}`;
  }

  private isReliableSku(sku: string) {
    const normalized = sku.trim().toUpperCase();
    return Boolean(normalized) && !normalized.startsWith('WRONG-') && !normalized.startsWith('NO-SKU');
  }

  private inferGarmentKind(value: string) {
    const normalized = this.normalizeText(value);
    if (/\b(sudadera|hoodie|hd)\b/.test(normalized)) return 'SUDADERA';
    if (/\b(camiseta|shirt|tshirt|ts)\b/.test(normalized)) return 'CAMISETA';
    return null;
  }

  private normalizeSize(value: string) {
    const normalized = this.normalizeText(value).toUpperCase();
    const match = normalized.match(/(^|[^A-Z])(XXL|XL|L|M|S)([^A-Z]|$)/);
    return match?.[2] ?? null;
  }

  private normalizeColor(value: string) {
    const normalized = this.normalizeText(value);
    const rules: Array<[string, RegExp]> = [
      ['BLANCA', /\b(blanco|blanca|white|wht)\b/],
      ['NEGRA', /\b(negro|negra|black|blk)\b/],
      ['SAND', /\b(sand|arena|mastic)\b/],
      ['CHARCOAL', /\b(charcoal|carbon|gris|dark grey|dark gray)\b/],
      ['TANGERINE', /\b(tangerine|naranja|orange)\b/],
      ['AZUL', /\b(azul|blue)\b/],
      ['MARRON', /\b(marron|brown)\b/],
      ['ROSA', /\b(rosa|pink)\b/],
      ['NAVY', /\b(navy|marino)\b/]
    ];
    return rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
  }

  private normalizeText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  async reopenPreparation(id: string) {
    const existing = await this.findOne(id);
    await this.restoreStockForPreparation(existing.id);
    await this.cancelPendingShipmentsForReopenedOrder(existing.id);
    const order = await this.prisma.order.update({
      where: { id: existing.id },
      data: {
        operationalStatus: 'WAITING_PICKING',
        preparedAt: null
      },
      include: { items: this.activeOrderItemsInclude(), shipments: true }
    });
    await this.activity.log({
      entityType: 'Order',
      entityId: existing.id,
      action: 'ORDER_REOPENED_PREPARATION',
      message: `Pedido ${existing.orderNumber} devuelto a sin preparar`
    });
    return order;
  }

  private async cancelPendingShipmentsForReopenedOrder(orderId: string) {
    await this.prisma.shipment.updateMany({
      where: {
        orderId,
        status: { in: ['PENDING', 'PARCEL_CREATED', 'LABEL_CREATED', 'PRINTED', 'ERROR'] }
      },
      data: { status: 'CANCELLED' }
    });
  }

  async importShopifyOrders() {
    const imported = await this.shopify.importRecentOrders();
    const results = [];
    for (const order of imported) {
      results.push(await this.upsertImportedOrder(order));
    }
    return { imported: results.length, orders: results };
  }

  async importSheetPendingOrders(rows: SheetPendingOrderRow[]) {
    const grouped = new Map<string, SheetPendingOrderRow[]>();
    for (const row of rows) {
      const orderNumber = this.normalizeOrderNumber(row.orderNumber);
      if (!orderNumber || !row.title?.trim()) continue;
      const current = grouped.get(orderNumber) ?? [];
      current.push({ ...row, orderNumber });
      grouped.set(orderNumber, current);
    }
    const pendingOrderNumbers = new Set(grouped.keys());

    const imported = [];
    const skipped = [];
    for (const [orderNumber, orderRows] of grouped) {
      const existing = await this.prisma.order.findUnique({ where: { orderNumber } });
      if (existing && !existing.shopifyOrderId.startsWith('sheet:')) {
        skipped.push({ orderNumber, reason: 'already_exists_from_shopify' });
        continue;
      }

      const first = orderRows[0];
      const order = await this.upsertImportedOrder({
        shopifyOrderId: `sheet:${orderNumber}`,
        orderNumber,
        customerName: 'Pedido de hoja',
        customerEmail: undefined,
        shippingMethod: first.shippingMethod || 'Sin envio en hoja',
        shippingCountry: 'ES',
        shippingAddressJson: { source: 'MEJOR PRODUCCION/PEDIDOS' },
        financialStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        operationalStatus: 'WAITING_PRODUCTION',
        orderedAt: this.parseSheetDate(first.orderedAt),
        items: orderRows.map((row, index) => ({
          shopifyLineItemId: `sheet:${orderNumber}:${index + 1}`,
          sku: this.sheetSku(row, index),
          title: row.title.trim(),
          variantTitle: row.size,
          quantity: Number(row.quantity ?? 1) || 1,
          imageUrl: row.imageUrl || undefined,
          imageUrlsJson: row.imageUrl ? [row.imageUrl] : [],
          color: row.color || undefined,
          size: row.size || undefined,
          productType: row.productType || undefined
        }))
      });

      await this.activity.log({
        entityType: 'Order',
        entityId: order.id,
        action: 'SHEET_IMPORT_UNPREPARED',
        message: `Pedido ${orderNumber} importado desde hoja PEDIDOS`,
        metadataJson: { rows: orderRows.length }
      });
      imported.push(order);
    }

    const archived = await this.archivePreparedSheetOrders(pendingOrderNumbers);

    return {
      receivedRows: rows.length,
      imported: imported.length,
      skipped: skipped.length,
      archivedPrepared: archived.length,
      skippedOrders: skipped,
      archivedOrders: archived,
      orders: imported
    };
  }

  private async archivePreparedSheetOrders(pendingOrderNumbers: Set<string>) {
    const staleOrders = await this.prisma.order.findMany({
      where: {
        shopifyOrderId: { startsWith: 'sheet:' },
        orderNumber: { notIn: [...pendingOrderNumbers] },
        operationalStatus: { notIn: ['SHIPPED', 'CANCELLED'] }
      },
      select: { id: true, orderNumber: true }
    });

    if (!staleOrders.length) return [];

    const now = new Date();
    await this.prisma.order.updateMany({
      where: { id: { in: staleOrders.map((order) => order.id) } },
      data: {
        operationalStatus: 'SHIPPED',
        fulfillmentStatus: 'fulfilled',
        preparedAt: now
      }
    });
    await this.prisma.productionTask.updateMany({
      where: { orderId: { in: staleOrders.map((order) => order.id) } },
      data: { status: 'DONE', completedAt: now }
    });

    for (const order of staleOrders) {
      await this.activity.log({
        entityType: 'Order',
        entityId: order.id,
        action: 'SHEET_IMPORT_ARCHIVED_PREPARED',
        message: `Pedido ${order.orderNumber} archivado porque ya aparece preparado en la hoja`
      });
    }

    return staleOrders;
  }

  async handleShopifyOrderCreated(payload: unknown, hmac?: string, rawBody?: Buffer) {
    this.shopify.assertValidWebhook(rawBody, hmac);
    await this.activity.log({
      entityType: 'ShopifyWebhook',
      entityId: 'orders-create',
      action: 'RECEIVED',
      message: 'Payload de creacion de pedido recibido',
      metadataJson: payload
    });
    const imported = this.shopify.mapWebhookOrder(payload);
    if (!imported) return { ok: true, processed: false };
    const order = await this.upsertImportedOrder(imported);
    return { ok: true, processed: true, order };
  }

  async handleShopifyOrderUpdated(payload: unknown, hmac?: string, rawBody?: Buffer) {
    this.shopify.assertValidWebhook(rawBody, hmac);
    await this.activity.log({
      entityType: 'ShopifyWebhook',
      entityId: 'orders-updated',
      action: 'RECEIVED',
      message: 'Payload de actualizacion de pedido recibido',
      metadataJson: payload
    });
    const imported = this.shopify.mapWebhookOrder(payload);
    if (!imported) return { ok: true, processed: false };
    const order = await this.upsertImportedOrder(imported);
    return { ok: true, processed: true, order };
  }

  async upsertImportedOrder(input: ImportedOrder) {
    const existingOrder = await this.prisma.order.findUnique({
      where: { shopifyOrderId: input.shopifyOrderId },
      include: { shipments: true }
    });
    const isSheetImport = input.shopifyOrderId.startsWith('sheet:');
    const hasMissingStock = input.items.some((item) => item.sku.includes('NO-STOCK'));
    const hasIncident = input.operationalStatus === 'BLOCKED';
    const calculated = this.priority.calculate({
      orderedAt: input.orderedAt,
      shippingMethod: input.shippingMethod,
      financialStatus: input.financialStatus,
      operationalStatus: input.operationalStatus,
      hasMissingStock,
      hasIncident
    });
    const locallyAdvancedStatuses = ['READY_FOR_LABEL', 'LABEL_CREATED', 'SHIPPED'];
    const hasShipped = existingOrder?.shipments.some((shipment) =>
      ['IN_TRANSIT', 'DELIVERED'].includes(shipment.status)
    );
    const hasCreatedLabel = existingOrder?.shipments.some((shipment) =>
      ['LABEL_CREATED', 'PRINTED'].includes(shipment.status)
    );
    const isCancelled = input.operationalStatus === 'CANCELLED';
    const isLocallyAdvanced = existingOrder && locallyAdvancedStatuses.includes(existingOrder.operationalStatus);
    const operationalStatus = isCancelled
      ? 'CANCELLED'
      : isSheetImport
      ? calculated.operationalStatus
      : hasShipped
      ? 'SHIPPED'
      : hasCreatedLabel && isLocallyAdvanced
      ? 'LABEL_CREATED'
      : isLocallyAdvanced
      ? existingOrder.operationalStatus
      : calculated.operationalStatus;

    const order = await this.prisma.order.upsert({
      where: { shopifyOrderId: input.shopifyOrderId },
      update: {
        shippingMethod: input.shippingMethod,
        financialStatus: input.financialStatus,
        fulfillmentStatus: input.fulfillmentStatus,
        operationalStatus,
        priorityLevel: calculated.priorityLevel,
        internalDeadlineAt: calculated.internalDeadlineAt,
        subtotalPrice: input.subtotalPrice ?? null,
        totalShipping: input.totalShipping ?? null,
        totalTax: input.totalTax ?? null,
        totalDiscount: input.totalDiscount ?? null,
        totalPrice: input.totalPrice ?? null,
        currency: input.currency ?? null
      },
      create: {
        shopifyOrderId: input.shopifyOrderId,
        orderNumber: input.orderNumber,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        shippingMethod: input.shippingMethod,
        shippingCountry: input.shippingCountry,
        shippingAddressJson: input.shippingAddressJson as Prisma.InputJsonValue,
        financialStatus: input.financialStatus,
        fulfillmentStatus: input.fulfillmentStatus,
        operationalStatus,
        priorityLevel: calculated.priorityLevel,
        orderedAt: input.orderedAt,
        internalDeadlineAt: calculated.internalDeadlineAt,
        subtotalPrice: input.subtotalPrice ?? null,
        totalShipping: input.totalShipping ?? null,
        totalTax: input.totalTax ?? null,
        totalDiscount: input.totalDiscount ?? null,
        totalPrice: input.totalPrice ?? null,
        currency: input.currency ?? null
      },
      include: { items: true }
    });

    const syncResult = await this.syncOrderItemsFromShopify(order.id, input.items);
    if (syncResult.changed) {
      await this.prisma.productionTask.deleteMany({ where: { orderId: order.id } });
      const items = await this.prisma.orderItem.findMany({
        where: { orderId: order.id, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'asc' }
      });
      await this.prisma.productionTask.createMany({ data: this.taskFactory.buildTasks(order, items) });
      if (existingOrder) {
        await this.activity.log({
          entityType: 'Order',
          entityId: order.id,
          action: 'SHOPIFY_ORDER_LINES_SYNCED',
          message: `Pedido ${order.orderNumber} actualizado desde Shopify: ${syncResult.created} nuevas, ${syncResult.updated} cambiadas, ${syncResult.cancelled} eliminadas`,
          metadataJson: syncResult
        });
      }
    }

    return this.findOne(order.id);
  }

  private async syncOrderItemsFromShopify(orderId: string, incomingItems: ImportedOrder['items']) {
    const existingItems = await this.prisma.orderItem.findMany({ where: { orderId } });
    const existingByLineId = new Map(existingItems.filter((item) => item.shopifyLineItemId).map((item) => [item.shopifyLineItemId!, item]));
    const seenIds = new Set<string>();
    let created = 0;
    let updated = 0;
    let cancelled = 0;

    for (const item of incomingItems) {
      const data = this.orderItemData(orderId, item);
      const existing = item.shopifyLineItemId ? existingByLineId.get(item.shopifyLineItemId) : undefined;
      if (!existing) {
        await this.prisma.orderItem.create({ data });
        created += 1;
        if (item.shopifyLineItemId) seenIds.add(item.shopifyLineItemId);
        continue;
      }
      seenIds.add(existing.shopifyLineItemId!);
      if (this.orderItemChanged(existing, item)) {
        await this.prisma.orderItem.update({
          where: { id: existing.id },
          data: {
            ...data,
            status: existing.status === 'CANCELLED' ? 'PENDING' : existing.status
          }
        });
        updated += 1;
      } else if (existing.status === 'CANCELLED') {
        await this.prisma.orderItem.update({ where: { id: existing.id }, data: { status: 'PENDING' } });
        updated += 1;
      }
    }

    const incomingIds = new Set(incomingItems.map((item) => item.shopifyLineItemId).filter((id): id is string => Boolean(id)));
    const removedItems = existingItems.filter((item) =>
      item.shopifyLineItemId &&
      !incomingIds.has(item.shopifyLineItemId) &&
      item.status !== 'CANCELLED'
    );
    for (const item of removedItems) {
      await this.prisma.orderItem.update({ where: { id: item.id }, data: { status: 'CANCELLED' } });
      cancelled += 1;
    }

    return { changed: created > 0 || updated > 0 || cancelled > 0, created, updated, cancelled, seenLineItemIds: [...seenIds] };
  }

  private orderItemData(orderId: string, item: ImportedOrder['items'][number]): Prisma.OrderItemUncheckedCreateInput {
    return {
      orderId,
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
    };
  }

  private orderItemChanged(existing: OrderItem, incoming: ImportedOrder['items'][number]) {
    return existing.shopifyProductId !== (incoming.shopifyProductId ?? null) ||
      existing.shopifyVariantId !== (incoming.shopifyVariantId ?? null) ||
      existing.sku !== incoming.sku ||
      existing.title !== incoming.title ||
      existing.variantTitle !== (incoming.variantTitle ?? null) ||
      existing.quantity !== incoming.quantity ||
      existing.imageUrl !== (incoming.imageUrl ?? null) ||
      JSON.stringify(existing.imageUrlsJson ?? []) !== JSON.stringify(incoming.imageUrlsJson ?? []) ||
      existing.color !== (incoming.color ?? null) ||
      existing.size !== (incoming.size ?? null) ||
      existing.productType !== (incoming.productType ?? null) ||
      existing.unitPrice !== (incoming.unitPrice ?? null) ||
      existing.lineDiscount !== (incoming.lineDiscount ?? null);
  }

  private async filterByMinimumOrderNumber<T extends { id: string; orderNumber: string; shopifyOrderId?: string }>(orders: T[]) {
    const minimum = Number(this.config.get('SHOPIFY_MIN_ORDER_NUMBER') ?? 0);
    if (!minimum) return orders;
    const sheetImportedIds = await this.sheetImportedOrderIds();
    return orders.filter((order) =>
      sheetImportedIds.has(order.id) ||
      order.shopifyOrderId?.startsWith('sheet:') ||
      this.orderNumberValue(order.orderNumber) >= minimum
    );
  }

  private async sheetImportedOrderIds() {
    const logs = await this.prisma.activityLog.findMany({
      where: { action: 'SHEET_IMPORT_UNPREPARED', entityType: 'Order' },
      select: { entityId: true },
      distinct: ['entityId']
    });
    return new Set(logs.map((log) => log.entityId));
  }

  private orderNumberValue(orderNumber: string) {
    return Number(orderNumber.replace(/\D/g, '')) || 0;
  }

  private normalizeOrderNumber(value?: string) {
    const cleaned = String(value ?? '').trim();
    if (!cleaned) return '';
    const number = this.orderNumberValue(cleaned);
    return number ? `#${number}` : cleaned;
  }

  private parseSheetDate(value?: string) {
    if (!value) return new Date();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private sheetSku(row: SheetPendingOrderRow, index: number) {
    const sku = row.sku?.trim();
    if (sku) return sku;
    const slug = row.title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    return `SHEET-${slug || 'ITEM'}-${index + 1}`;
  }
}

export interface ImportedOrder {
  shopifyOrderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string;
  shippingMethod: string;
  shippingCountry?: string;
  shippingAddressJson?: unknown;
  financialStatus: string;
  fulfillmentStatus?: string;
  operationalStatus?: string;
  orderedAt: Date;
  subtotalPrice?: number;
  totalShipping?: number;
  totalTax?: number;
  totalDiscount?: number;
  totalPrice?: number;
  currency?: string;
  items: Array<{
    shopifyLineItemId?: string;
    shopifyProductId?: string;
    shopifyVariantId?: string;
    sku: string;
    title: string;
    variantTitle?: string;
    quantity: number;
    imageUrl?: string;
    imageUrlsJson?: Prisma.InputJsonValue;
    color?: string;
    size?: string;
    productType?: string;
    unitPrice?: number;
    lineDiscount?: number;
  }>;
}

interface SheetPendingOrderRow {
  orderNumber: string;
  title: string;
  quantity?: number;
  shippingMethod?: string;
  orderedAt?: string;
  productType?: string;
  color?: string;
  size?: string;
  sku?: string;
  imageUrl?: string;
}
