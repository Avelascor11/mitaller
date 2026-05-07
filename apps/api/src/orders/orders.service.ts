import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../activity/activity.service';
import { PriorityService } from '../priority/priority.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyAdapter } from '../shopify/shopify.adapter';
import { OrderTaskFactoryService } from './order-task-factory.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly priority: PriorityService,
    private readonly shopify: ShopifyAdapter,
    private readonly taskFactory: OrderTaskFactoryService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService
  ) {}

  async findAll() {
    const orders = await this.prisma.order.findMany({
      orderBy: [{ priorityLevel: 'asc' }, { internalDeadlineAt: 'asc' }],
      include: { items: true, shipments: true }
    });
    return this.filterByMinimumOrderNumber(orders);
  }

  async findPendingPreparation() {
    const orders = await this.prisma.order.findMany({
      where: {
        operationalStatus: {
          notIn: ['READY_FOR_LABEL', 'LABEL_CREATED', 'SHIPPED', 'CANCELLED']
        }
      },
      orderBy: [{ priorityLevel: 'asc' }, { internalDeadlineAt: 'asc' }, { orderedAt: 'asc' }],
      include: { items: true, shipments: true }
    });
    return this.filterByMinimumOrderNumber(orders);
  }

  findOne(id: string) {
    return this.prisma.order.findFirstOrThrow({
      where: { OR: [{ id }, { orderNumber: id }, { shopifyOrderId: id }] },
      include: { items: true, productionTasks: true, shipments: true }
    });
  }

  async markPrepared(id: string) {
    const existing = await this.findOne(id);
    const order = await this.prisma.order.update({
      where: { id: existing.id },
      data: { operationalStatus: 'READY_FOR_LABEL' },
      include: { items: true, shipments: true }
    });
    await this.prisma.productionTask.updateMany({
      where: {
        orderId: existing.id,
        title: { startsWith: 'Preparar pedido' }
      },
      data: { status: 'DONE', completedAt: new Date() }
    });
    await this.activity.log({
      entityType: 'Order',
      entityId: existing.id,
      action: 'ORDER_PREPARED',
      message: `Pedido ${existing.orderNumber} marcado como preparado`
    });
    return order;
  }

  async reopenPreparation(id: string) {
    const existing = await this.findOne(id);
    const order = await this.prisma.order.update({
      where: { id: existing.id },
      data: { operationalStatus: 'WAITING_PICKING' },
      include: { items: true, shipments: true }
    });
    await this.activity.log({
      entityType: 'Order',
      entityId: existing.id,
      action: 'ORDER_REOPENED_PREPARATION',
      message: `Pedido ${existing.orderNumber} devuelto a sin preparar`
    });
    return order;
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

    return { receivedRows: rows.length, imported: imported.length, skipped: skipped.length, skippedOrders: skipped, orders: imported };
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
    const hasCreatedLabel = existingOrder?.shipments.some((shipment) =>
      shipment.status === 'LABEL_CREATED' || Boolean(shipment.trackingNumber)
    );
    const operationalStatus = hasCreatedLabel
      ? 'LABEL_CREATED'
      : existingOrder && locallyAdvancedStatuses.includes(existingOrder.operationalStatus)
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
        internalDeadlineAt: calculated.internalDeadlineAt
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
        items: { create: input.items }
      },
      include: { items: true }
    });

    await this.prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    for (const item of input.items) {
      await this.prisma.orderItem.create({
        data: {
          ...item,
          imageUrlsJson: item.imageUrlsJson ?? [],
          orderId: order.id
        }
      });
    }

    await this.prisma.productionTask.deleteMany({ where: { orderId: order.id } });
    const items = await this.prisma.orderItem.findMany({ where: { orderId: order.id } });
    await this.prisma.productionTask.createMany({ data: this.taskFactory.buildTasks(order, items) });
    return this.findOne(order.id);
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
