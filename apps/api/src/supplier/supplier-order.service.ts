import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseService } from '../purchasing/purchase.service';
import { SupplierAdapter, SupplierPurchaseOrderPayload } from './supplier.adapter';

const OPEN_SUPPLIER_ORDER_STATUSES = ['SUBMITTED'];
const FALKROSS_PRICE_NOTE = [
  'Camiseta 032.42 -> 2.70 EUR',
  'Camiseta Gildan 180.09 -> 2.84 EUR',
  'Sudadera 208.42 / WG002 -> 10.75 EUR'
].join(' | ');

const FALKROSS_STYLE_PRICES: Record<string, string> = {
  '03242': '2.70',
  '18009': '2.84',
  '20842': '10.75',
  '23742': '6.60',
  '24042': '6.00',
  '29009': '7.30'
};

@Injectable()
export class SupplierOrderService {
  private readonly logger = new Logger(SupplierOrderService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly purchases: PurchaseService,
    private readonly supplier: SupplierAdapter,
    private readonly activity: ActivityService
  ) {}

  listPurchaseOrders() {
    return this.prisma.supplierPurchaseOrder.findMany({
      include: { lines: { include: { stockItem: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100
    }).then((orders) => orders.map((order) => this.withOrderNote(order)));
  }

  async getPurchaseOrder(id: string) {
    const order = await this.prisma.supplierPurchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { lines: { include: { stockItem: true } } }
    });
    return this.withOrderNote(order);
  }

  async getPurchaseOrderProof(id: string) {
    const order = await this.prisma.supplierPurchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { lines: true }
    });
    const rawRequest = (order.rawRequestJson as unknown as SupplierPurchaseOrderPayload | null) ?? this.payloadFromOrder(order);
    const rawResponse = order.rawResponseJson as Record<string, unknown> | null;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      mode: order.mode,
      externalOrderId: order.externalOrderId,
      submittedAt: order.submittedAt,
      errorMessage: order.errorMessage,
      supplierSearchHint: order.externalOrderId
        ? `Falk & Ross debe buscar orders_id ${order.externalOrderId} o referencia ${order.orderNumber}`
        : `Este pedido aun no esta enviado a Falk & Ross. Solo existe como borrador interno ${order.orderNumber}.`,
      requestXml: this.supplier.buildFalkRossOrderXmlPreview(rawRequest),
      responseStatus: rawResponse?.status ?? null,
      responseXml: typeof rawResponse?.xml === 'string' ? rawResponse.xml : null,
      lines: order.lines.map((line) => ({
        supplierSku: line.supplierSku,
        name: line.name,
        quantity: line.quantity,
        color: line.color,
        size: line.size
      }))
    };
  }

  @Cron('0 20 * * *', { timeZone: 'Europe/Madrid' })
  async generateDailyFalkRossOrderCron() {
    if (this.config.get<string>('FALKROSS_DAILY_AUTO_ORDER') !== 'true') return;
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const result = await this.generateDailyFalkRossOrder({ submit: false, source: 'cron' });
      this.logger.log(`Falk & Ross daily order: ${result.status} (${result.lines?.length ?? 0} lines)`);
    } catch (error) {
      this.logger.error(`Falk & Ross daily order failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isRunning = false;
    }
  }

  async generateDailyFalkRossOrder(options: { submit?: boolean; source?: string; purchaseMode?: 'NORMAL' | 'SAFETY_STOCK' } = {}) {
    const purchaseMode = options.purchaseMode ?? 'SAFETY_STOCK';
    const orderDate = this.todayStart();
    const existing = await this.prisma.supplierPurchaseOrder.findUnique({
      where: { supplier_orderDate: { supplier: 'FALK_ROSS', orderDate } },
      include: { lines: true }
    });
    if (existing?.status === 'SUBMITTED') {
      return { status: 'already_exists', order: this.withOrderNote(existing), lines: existing.lines };
    }
    if (existing?.status === 'DRAFT') {
      await this.prisma.supplierPurchaseOrder.delete({ where: { id: existing.id } });
    }

    await this.syncSupplierStockBeforeOrdering();
    const matrix = await this.purchases.getPurchaseMatrix();
    const [supplierArticles, supplierStocks] = await Promise.all([
      this.prisma.supplierArticle.findMany({ where: { supplier: 'FALK_ROSS' } }),
      this.prisma.supplierStock.findMany({ where: { supplier: 'FALK_ROSS' } })
    ]);
    const articleBySku = new Map(supplierArticles.map((article) => [article.supplierSku, article]));
    const stockBySku = new Map(supplierStocks.map((stock) => [stock.supplierSku, stock]));

    const lines = matrix.groups
      .filter((group) => ['CAMISETA', 'SUDADERA'].includes(group.garmentType))
      .flatMap((group) => group.sizes.map((entry) => ({ group, entry })))
      .filter(({ entry }) => entry.stockItemId && entry.supplierSku && entry.recommendedPurchaseQuantity > 0)
      .map(({ group, entry }) => {
        const article = this.resolveFalkRossArticle(group.garmentType, group.color, entry.size, entry.supplierSku, supplierArticles, articleBySku)
          ?? this.resolveFalkRossStockOnlyFallback(group.garmentType, group.color, entry.size, supplierStocks);
        const expectedStyles = this.expectedFalkRossStyles(group.garmentType, group.color);
        const supplierSku = article?.supplierSku ?? expectedStyles[0] ?? entry.supplierSku!;
        const resolvedStyleKey = this.falkRossStyleKey(article?.styleCode ?? article?.productName ?? expectedStyles[0]);
        const supplierStock = article ? stockBySku.get(supplierSku) : null;
        const supplierAvailableQuantity = supplierStock?.availableQuantity ?? null;
        const alreadyPending = entry.alreadyOrderedQuantity ?? 0;
        const requestedQuantity = purchaseMode === 'NORMAL'
          ? Math.max(0, entry.pendingOrderNeed - entry.currentInternalStock)
          : Math.max(0, entry.pendingOrderNeed + entry.minStockTarget - entry.currentInternalStock);
        const quantity = this.orderableQuantity(requestedQuantity, supplierAvailableQuantity);
        return {
          stockItemId: entry.stockItemId!,
          supplierSku,
          name: this.falkRossLineName(group.garmentType, group.color, entry.size, entry.subproductName),
          color: group.color,
          size: entry.size,
          quantity,
          supplierAvailableQuantity,
          supplierStockSpain24h: supplierStock?.stockSpain24h ?? null,
          supplierStockCentral3To5Days: supplierStock?.stockCentral3To5Days ?? null,
          supplierStockSupplier5To20Days: supplierStock?.stockSupplier5To20Days ?? null,
          purchasePrice: FALKROSS_STYLE_PRICES[resolvedStyleKey] ?? article?.purchasePrice ?? null,
          rawDataJson: {
            pendingOrderNeed: entry.pendingOrderNeed,
            currentInternalStock: entry.currentInternalStock,
            minStockTarget: entry.minStockTarget,
            purchaseMode,
            recommendedPurchaseQuantity: entry.recommendedPurchaseQuantity,
            alreadyPendingSupplierOrderQuantity: alreadyPending,
            stockItemSupplierSku: entry.supplierSku,
            resolvedSupplierSku: supplierSku,
            resolvedStyleCode: article?.styleCode ?? (article ? expectedStyles[0] : undefined),
            expectedStyleCode: expectedStyles[0],
            expectedProductNumber: expectedStyles[1],
            resolvedProductName: article?.productName,
            supplierStockSpain24h: supplierStock?.stockSpain24h ?? null,
            supplierStockCentral3To5Days: supplierStock?.stockCentral3To5Days ?? null,
            supplierStockSupplier5To20Days: supplierStock?.stockSupplier5To20Days ?? null,
            demandOrders: entry.demandOrders.map((order) => order.orderNumber)
          }
        };
      })
      .filter((line) => line.quantity > 0)
      .sort((left, right) => left.supplierSku.localeCompare(right.supplierSku));

    if (!lines.length) {
      return { status: 'empty', lines: [] };
    }

    const payload: SupplierPurchaseOrderPayload = {
      supplier: 'FALK_ROSS',
      orderNumber: this.orderNumber(orderDate),
      requestedAt: new Date().toISOString(),
      source: options.source ?? 'manual',
      purchaseMode,
      orderNote: this.falkRossOrderNote(),
      lines: lines.map((line) => ({
        supplierSku: line.supplierSku,
        name: line.name,
        quantity: line.quantity,
        color: line.color,
        size: line.size
      }))
    };

    const created = await this.prisma.supplierPurchaseOrder.create({
      data: {
        supplier: 'FALK_ROSS',
        orderNumber: payload.orderNumber,
        orderDate,
        status: 'DRAFT',
        mode: this.supplier.orderMode(),
        rawRequestJson: payload as unknown as Prisma.InputJsonValue,
        lines: {
          create: lines.map((line) => ({
            stockItemId: line.stockItemId,
            supplierSku: line.supplierSku,
            name: line.name,
            color: line.color,
            size: line.size,
            quantity: line.quantity,
            supplierAvailableQuantity: line.supplierAvailableQuantity,
            supplierStockSpain24h: line.supplierStockSpain24h,
            supplierStockCentral3To5Days: line.supplierStockCentral3To5Days,
            supplierStockSupplier5To20Days: line.supplierStockSupplier5To20Days,
            purchasePrice: line.purchasePrice,
            rawDataJson: line.rawDataJson as Prisma.InputJsonValue
          }))
        }
      },
      include: { lines: true }
    });

    await this.activity.log({
      entityType: 'SupplierPurchaseOrder',
      entityId: created.id,
      action: 'SUPPLIER_PURCHASE_ORDER_CREATED',
      message: `Pedido Falk & Ross ${created.orderNumber} creado con ${created.lines.length} lineas`,
      metadataJson: { source: options.source ?? 'manual', submit: Boolean(options.submit) }
    });

    if (options.submit && this.config.get<string>('FALKROSS_ALLOW_AUTO_SUBMIT') === 'true') {
      return this.submitPurchaseOrder(created.id);
    }

    return { status: 'created', order: this.withOrderNote(created), lines: created.lines };
  }

  async getExtraPurchaseCatalog() {
    await this.syncSupplierStockBeforeOrdering();
    let context = await this.extraPurchaseContext();
    if (await this.ensureExtraPurchaseThreeXLStockItems(context.matrix, context.supplierArticles, context.supplierStocks)) {
      context = await this.extraPurchaseContext();
    }
    const { matrix, supplierArticles, supplierStocks, articleBySku, stockBySku } = context;
    const groups = matrix.groups
      .filter((group) => ['CAMISETA', 'SUDADERA'].includes(group.garmentType))
      .map((group) => {
        const items = group.sizes.flatMap((entry) => {
          if (!entry.stockItemId || !entry.supplierSku) return [];
          const article = this.resolveFalkRossArticle(
            group.garmentType,
            group.color,
            entry.size,
            entry.supplierSku,
            supplierArticles,
            articleBySku
          ) ?? this.resolveFalkRossStockOnlyFallback(group.garmentType, group.color, entry.size, supplierStocks);
          if (!article) return [];
          const styleKey = this.falkRossStyleKey(article.styleCode ?? article.productName);
          const unitPrice = FALKROSS_STYLE_PRICES[styleKey] ?? article.purchasePrice?.toString();
          if (!unitPrice) return [];
          const supplierStock = stockBySku.get(article.supplierSku);
          return [{
            stockItemId: entry.stockItemId,
            supplierSku: article.supplierSku,
            name: this.falkRossLineName(group.garmentType, group.color, entry.size, entry.subproductName),
            size: entry.size,
            unitPrice: Number(unitPrice),
            availableQuantity: supplierStock?.availableQuantity ?? null,
            stockSpain24h: supplierStock?.stockSpain24h ?? null,
            stockCentral3To5Days: supplierStock?.stockCentral3To5Days ?? null
          }];
        });
        const expectedStyles = this.expectedFalkRossStyles(group.garmentType, group.color);
        return {
          id: `${group.garmentType}-${this.falkRossStyleKey(expectedStyles[0])}-${this.normalizedColor(group.color)}`,
          garmentType: group.garmentType,
          modelCode: expectedStyles[0],
          modelName: this.falkRossModelName(group.garmentType, group.color),
          color: group.color,
          items
        };
      })
      .filter((group) => group.items.length > 0)
      .sort((left, right) => `${left.garmentType}-${left.modelName}-${left.color}`.localeCompare(`${right.garmentType}-${right.modelName}-${right.color}`));

    return {
      supplier: 'FALK_ROSS',
      currency: 'EUR',
      vatRate: this.rate(this.config.get<string>('FALKROSS_VAT_RATE'), 0.21),
      orderNote: this.falkRossOrderNote(),
      groups
    };
  }

  async generateExtraFalkRossOrder(input: {
    lines: Array<{ stockItemId: string; quantity: number }>;
    comment?: string;
  }) {
    const quantities = new Map<string, number>();
    for (const line of input.lines) {
      const stockItemId = line.stockItemId.trim();
      const quantity = Math.floor(line.quantity);
      if (!stockItemId || !Number.isFinite(quantity) || quantity <= 0) continue;
      quantities.set(stockItemId, (quantities.get(stockItemId) ?? 0) + quantity);
    }
    if (!quantities.size) throw new BadRequestException('Selecciona al menos una camiseta o sudadera');

    await this.syncSupplierStockBeforeOrdering();
    const { matrix, supplierArticles, supplierStocks, articleBySku, stockBySku } = await this.extraPurchaseContext();
    const entriesByStockItemId = new Map(
      matrix.groups
        .filter((group) => ['CAMISETA', 'SUDADERA'].includes(group.garmentType))
        .flatMap((group) => group.sizes
          .filter((entry) => entry.stockItemId)
          .map((entry) => [entry.stockItemId!, { group, entry }] as const))
    );

    const unresolved: string[] = [];
    const lines = Array.from(quantities.entries()).flatMap(([stockItemId, requestedQuantity]) => {
      const mapped = entriesByStockItemId.get(stockItemId);
      if (!mapped || !mapped.entry.supplierSku) {
        unresolved.push(stockItemId);
        return [];
      }
      const { group, entry } = mapped;
      const article = this.resolveFalkRossArticle(
        group.garmentType,
        group.color,
        entry.size,
        entry.supplierSku,
        supplierArticles,
        articleBySku
      ) ?? this.resolveFalkRossStockOnlyFallback(group.garmentType, group.color, entry.size, supplierStocks);
      if (!article) {
        unresolved.push(`${entry.subproductName} ${entry.size}`);
        return [];
      }
      const styleKey = this.falkRossStyleKey(article.styleCode ?? article.productName);
      const purchasePrice = FALKROSS_STYLE_PRICES[styleKey] ?? article.purchasePrice?.toString();
      if (!purchasePrice) {
        unresolved.push(`${entry.subproductName} ${entry.size} (sin precio)`);
        return [];
      }
      const supplierStock = stockBySku.get(article.supplierSku);
      const quantity = this.orderableQuantity(requestedQuantity, supplierStock?.availableQuantity ?? null);
      if (quantity <= 0) {
        unresolved.push(`${entry.subproductName} ${entry.size} (sin stock)`);
        return [];
      }
      return [{
        stockItemId,
        supplierSku: article.supplierSku,
        name: this.falkRossLineName(group.garmentType, group.color, entry.size, entry.subproductName),
        color: group.color,
        size: entry.size,
        quantity,
        supplierAvailableQuantity: supplierStock?.availableQuantity ?? null,
        supplierStockSpain24h: supplierStock?.stockSpain24h ?? null,
        supplierStockCentral3To5Days: supplierStock?.stockCentral3To5Days ?? null,
        supplierStockSupplier5To20Days: supplierStock?.stockSupplier5To20Days ?? null,
        purchasePrice,
        rawDataJson: {
          purchaseMode: 'EXTRA',
          requestedQuantity,
          resolvedSupplierSku: article.supplierSku,
          resolvedStyleCode: article.styleCode ?? this.expectedFalkRossStyles(group.garmentType, group.color)[0],
          supplierStockSpain24h: supplierStock?.stockSpain24h ?? null,
          supplierStockCentral3To5Days: supplierStock?.stockCentral3To5Days ?? null,
          supplierStockSupplier5To20Days: supplierStock?.stockSupplier5To20Days ?? null
        }
      }];
    });

    if (unresolved.length) {
      throw new BadRequestException(`No se puede preparar el pedido extra: ${unresolved.join(', ')}`);
    }

    const orderDate = new Date();
    const payload: SupplierPurchaseOrderPayload = {
      supplier: 'FALK_ROSS',
      orderNumber: this.extraOrderNumber(orderDate),
      requestedAt: orderDate.toISOString(),
      source: 'manual-extra',
      purchaseMode: 'EXTRA',
      orderNote: this.falkRossOrderNote(input.comment),
      lines: lines.map((line) => ({
        supplierSku: line.supplierSku,
        name: line.name,
        quantity: line.quantity,
        color: line.color,
        size: line.size
      }))
    };

    const created = await this.prisma.supplierPurchaseOrder.create({
      data: {
        supplier: 'FALK_ROSS',
        orderNumber: payload.orderNumber,
        orderDate,
        status: 'DRAFT',
        mode: this.supplier.orderMode(),
        rawRequestJson: payload as unknown as Prisma.InputJsonValue,
        lines: {
          create: lines.map((line) => ({
            stockItemId: line.stockItemId,
            supplierSku: line.supplierSku,
            name: line.name,
            color: line.color,
            size: line.size,
            quantity: line.quantity,
            supplierAvailableQuantity: line.supplierAvailableQuantity,
            supplierStockSpain24h: line.supplierStockSpain24h,
            supplierStockCentral3To5Days: line.supplierStockCentral3To5Days,
            supplierStockSupplier5To20Days: line.supplierStockSupplier5To20Days,
            purchasePrice: line.purchasePrice,
            rawDataJson: line.rawDataJson as Prisma.InputJsonValue
          }))
        }
      },
      include: { lines: true }
    });

    await this.activity.log({
      entityType: 'SupplierPurchaseOrder',
      entityId: created.id,
      action: 'SUPPLIER_EXTRA_PURCHASE_ORDER_CREATED',
      message: `Pedido extra Falk & Ross ${created.orderNumber} creado con ${created.lines.length} lineas`,
      metadataJson: { comment: input.comment?.trim() || null }
    });

    return { status: 'created', order: this.withOrderNote(created), lines: created.lines };
  }

  async submitPurchaseOrder(id: string) {
    const order = await this.prisma.supplierPurchaseOrder.findUnique({
      where: { id },
      include: { lines: true }
    });
    if (!order) throw new BadRequestException('Pedido a proveedor no encontrado');
    if (!order.lines.length) throw new BadRequestException('El pedido a proveedor no tiene lineas');
    if (order.status === 'SUBMITTED') return { status: 'already_submitted', order: this.withOrderNote(order), lines: order.lines };
    const unresolvedLines = this.unresolvedFalkRossLines(order.lines);
    if (unresolvedLines.length) {
      throw new BadRequestException(`No se pudo resolver el SKU real de Falk & Ross para: ${unresolvedLines.join(', ')}`);
    }

    const payload = (order.rawRequestJson as unknown as SupplierPurchaseOrderPayload | null) ?? this.payloadFromOrder(order);

    const result = await this.supplier.submitPurchaseOrder(payload);
    const status = result.submitted ? 'SUBMITTED' : 'DRAFT';
    const updated = await this.prisma.supplierPurchaseOrder.update({
      where: { id },
      data: {
        status,
        mode: result.mode,
        externalOrderId: result.externalOrderId,
        submittedAt: result.submitted ? new Date() : null,
        errorMessage: result.errorMessage,
        rawResponseJson: result.rawResponseJson as Prisma.InputJsonValue
      },
      include: { lines: true }
    });

    await this.activity.log({
      entityType: 'SupplierPurchaseOrder',
      entityId: updated.id,
      action: result.submitted ? 'SUPPLIER_PURCHASE_ORDER_SUBMITTED' : 'SUPPLIER_PURCHASE_ORDER_DRAFTED',
      message: result.submitted
        ? `Pedido Falk & Ross ${updated.orderNumber} enviado al proveedor`
        : `Pedido Falk & Ross ${updated.orderNumber} guardado como borrador`,
      metadataJson: result.rawResponseJson
    });

    return { status: result.submitted ? 'submitted' : 'draft', order: this.withOrderNote(updated), lines: updated.lines, result };
  }

  private payloadFromOrder(order: { supplier: string; orderNumber: string; lines: Array<{ supplierSku: string; name: string; quantity: number; color: string | null; size: string | null }> }): SupplierPurchaseOrderPayload {
    return {
      supplier: order.supplier,
      orderNumber: order.orderNumber,
      requestedAt: new Date().toISOString(),
      source: 'submit',
      orderNote: this.falkRossOrderNote(),
      lines: order.lines.map((line) => ({
        supplierSku: line.supplierSku,
        name: line.name,
        quantity: line.quantity,
        color: line.color ?? undefined,
        size: line.size ?? undefined
      }))
    };
  }

  private withOrderNote<T extends {
    rawRequestJson: Prisma.JsonValue | null;
    lines?: Array<{ quantity: number; purchasePrice?: Prisma.Decimal | string | number | null }>;
  }>(order: T) {
    const rawRequest = order.rawRequestJson as SupplierPurchaseOrderPayload | null;
    const lines = order.lines ?? [];
    const unpricedLines = lines.filter((line) => line.purchasePrice == null).length;
    const subtotal = this.money(lines.reduce((sum, line) => sum + Number(line.purchasePrice ?? 0) * line.quantity, 0));
    const configuredShipping = this.config.get<string>('FALKROSS_SHIPPING_COST_EUR');
    const shippingCost = configuredShipping == null || configuredShipping.trim() === ''
      ? null
      : this.money(Number(configuredShipping));
    const vatRate = this.rate(this.config.get<string>('FALKROSS_VAT_RATE'), 0.21);
    const taxableBase = subtotal + (shippingCost ?? 0);
    const vatAmount = this.money(taxableBase * vatRate);
    return {
      ...order,
      lines: lines.map((line) => ({
        ...line,
        purchasePrice: line.purchasePrice == null ? null : Number(line.purchasePrice)
      })),
      orderNote: rawRequest?.orderNote ?? this.falkRossOrderNote(),
      purchaseMode: rawRequest?.purchaseMode ?? 'SAFETY_STOCK',
      costSummary: {
        currency: 'EUR',
        subtotal,
        shippingCost,
        vatRate,
        vatAmount,
        total: this.money(taxableBase + vatAmount),
        unpricedLines
      }
    };
  }

  private money(value: number) {
    return Number.isFinite(value) ? +value.toFixed(2) : 0;
  }

  private rate(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private async pendingSupplierOrderQuantityByStockItemId() {
    const orders = await this.prisma.supplierPurchaseOrder.findMany({
      where: { supplier: 'FALK_ROSS', status: { in: OPEN_SUPPLIER_ORDER_STATUSES } },
      include: { lines: true }
    });
    const quantities = new Map<string, number>();
    for (const order of orders) {
      for (const line of order.lines) {
        quantities.set(line.stockItemId, (quantities.get(line.stockItemId) ?? 0) + line.quantity);
      }
    }
    return quantities;
  }

  private async syncSupplierStockBeforeOrdering() {
    if (this.config.get<string>('FALKROSS_SYNC_STOCK_BEFORE_ORDER') !== 'true') return;
    if (!this.config.get<string>('FALKROSS_WEBSERVICE_USER') || !this.config.get<string>('FALKROSS_WEBSERVICE_PASSWORD')) return;
    try {
      const result = await this.supplier.syncStock();
      this.logger.log(`Falk & Ross stock synced before order: ${result.synced}`);
    } catch (error) {
      this.logger.warn(`Falk & Ross stock sync skipped before order: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private orderableQuantity(requestedQuantity: number, supplierAvailableQuantity: number | null) {
    if (requestedQuantity <= 0) return 0;
    if (this.config.get<string>('FALKROSS_ALLOW_BACKORDER') === 'true') return requestedQuantity;
    if (this.config.get<string>('FALKROSS_STRICT_SUPPLIER_STOCK') !== 'true') return requestedQuantity;
    if (supplierAvailableQuantity == null) return requestedQuantity;
    return Math.min(requestedQuantity, Math.max(0, supplierAvailableQuantity));
  }

  private unresolvedFalkRossLines(lines: Array<{ name: string; size: string | null; supplierSku: string; rawDataJson: Prisma.JsonValue | null }>) {
    return lines.flatMap((line) => {
      const rawData = line.rawDataJson as { resolvedStyleCode?: string | null } | null;
      return rawData?.resolvedStyleCode ? [] : [`${line.name}${line.size ? ` (${line.size})` : ''}`];
    });
  }

  private resolveFalkRossArticle(
    garmentType: string,
    color: string,
    size: string,
    supplierSku: string | null,
    articles: Array<{
      supplierSku: string;
      styleCode: string | null;
      productName: string;
      color: string | null;
      size: string | null;
      purchasePrice: Prisma.Decimal | null;
    }>,
    articleBySku: Map<string, {
      supplierSku: string;
      styleCode: string | null;
      productName: string;
      color: string | null;
      size: string | null;
      purchasePrice: Prisma.Decimal | null;
    }>
  ) {
    const direct = supplierSku ? articleBySku.get(supplierSku) : undefined;
    if (direct && this.articleMatchesGarment(direct, garmentType, color, size)) return direct;

    const expectedStyles = this.expectedFalkRossStyles(garmentType, color);
    return articles.find((article) =>
      this.articleMatchesStyle(article, expectedStyles) &&
      this.articleMatchesFalkRossColor(article, color) &&
      this.normalizedSize(article.size ?? article.productName) === this.normalizedSize(size)
    );
  }

  private resolveFalkRossStockOnlyFallback(
    garmentType: string,
    color: string,
    size: string,
    stocks: Array<{ supplierSku: string }>
  ) {
    // Falk & Ross sometimes publishes a valid SKU in stock before its article master.
    if (garmentType !== 'CAMISETA' || this.normalizedColor(color) !== 'AZUL') return null;
    const normalizedSize = this.normalizedSize(size);
    const supplierSku = normalizedSize === 'XXL'
      ? '032424256'
      : normalizedSize === '3XL'
        ? '032424257'
        : null;
    if (!supplierSku) return null;
    if (!stocks.some((stock) => stock.supplierSku === supplierSku)) return null;
    return {
      supplierSku,
      styleCode: '032.42',
      productName: 'TG002 - #E220 T-Shirt',
      color: 'Royal',
      size: normalizedSize === 'XXL' ? '2XL' : '3XL',
      purchasePrice: null
    };
  }

  private articleMatchesGarment(
    article: { styleCode: string | null; productName: string; color: string | null; size: string | null },
    garmentType: string,
    color: string,
    size: string
  ) {
    const expectedStyles = this.expectedFalkRossStyles(garmentType, color);
    return this.articleMatchesStyle(article, expectedStyles) &&
      this.articleMatchesFalkRossColor(article, color) &&
      this.normalizedSize(article.size ?? article.productName) === this.normalizedSize(size);
  }

  private articleMatchesFalkRossColor(article: { color: string | null; productName: string }, color: string) {
    const expectedColor = this.normalizedColor(color);
    const articleColor = article.color ?? article.productName;
    if (expectedColor === 'AZUL') return /\broyal(?: blue)?\b/.test(this.normalizedToken(articleColor));
    if (expectedColor === 'SAND') return this.normalizedToken(articleColor).includes('mastic');
    if (expectedColor === 'CHARCOAL') return this.normalizedToken(articleColor).includes('dark grey') || this.normalizedToken(articleColor).includes('dark gray');
    if (expectedColor === 'TANGERINE') return this.normalizedToken(articleColor).includes('tangerine') || this.normalizedToken(articleColor).includes('orange');
    if (expectedColor === 'ROSA') return this.normalizedToken(articleColor).includes('light pink');
    if (expectedColor === 'MARRON') return this.normalizedToken(articleColor).includes('dark chocolate');
    return this.normalizedColor(articleColor) === expectedColor;
  }

  private falkRossLineName(garmentType: string, color: string, size: string, fallback: string) {
    const colorLabel = this.falkRossColorLabel(color);
    if (!colorLabel) return fallback;
    return `${garmentType === 'SUDADERA' ? 'Sudadera' : 'Camiseta'} ${colorLabel} - ${size}`;
  }

  private falkRossColorLabel(color: string) {
    const normalized = this.normalizedColor(color);
    if (normalized === 'AZUL') return 'Royal Blue';
    if (normalized === 'SAND') return 'Mastic';
    if (normalized === 'CHARCOAL') return 'Dark Grey';
    if (normalized === 'TANGERINE') return 'Tangerine';
    if (normalized === 'ROSA') return 'Light Pink';
    if (normalized === 'MARRON') return 'Dark Chocolate';
    return null;
  }

  private articleMatchesStyle(article: { styleCode: string | null; productName: string }, expectedStyles: string[]) {
    const articleKey = this.falkRossStyleKey(article.styleCode ?? article.productName);
    return expectedStyles.some((style) => this.falkRossStyleKey(style) === articleKey);
  }

  private expectedFalkRossStyles(garmentType: string, color: string) {
    if (garmentType === 'SUDADERA') return ['WG002', '208.42', '20842'];
    if (['MARRON', 'ROSA', 'TANGERINE'].includes(this.normalizedColor(color))) return ['5000', '180.09', '18009'];
    return ['TG002', '032.42', '03242'];
  }

  private falkRossStyleKey(value: string) {
    const normalized = this.normalizedToken(value).replace(/\s/g, '');
    if (normalized.includes('03242') || normalized.includes('tg002')) return '03242';
    if (normalized.includes('20842') || normalized.includes('wg002')) return '20842';
    if (normalized.includes('23742') || normalized.includes('wg005')) return '23742';
    if (normalized.includes('24042')) return '24042';
    if (normalized.includes('29009')) return '29009';
    if (normalized.includes('18009') || normalized === '5000') return '18009';
    if (normalized.includes('10209') || normalized === '2000') return '10209';
    return normalized;
  }

  private async extraPurchaseContext() {
    const [matrix, supplierArticles, supplierStocks] = await Promise.all([
      this.purchases.getPurchaseMatrix(),
      this.prisma.supplierArticle.findMany({ where: { supplier: 'FALK_ROSS' } }),
      this.prisma.supplierStock.findMany({ where: { supplier: 'FALK_ROSS' } })
    ]);
    return {
      matrix,
      supplierArticles,
      supplierStocks,
      articleBySku: new Map(supplierArticles.map((article) => [article.supplierSku, article])),
      stockBySku: new Map(supplierStocks.map((stock) => [stock.supplierSku, stock]))
    };
  }

  private falkRossModelName(garmentType: string, color: string) {
    if (garmentType === 'SUDADERA') return 'Sudadera 208.42 / WG002';
    if (['MARRON', 'ROSA', 'TANGERINE'].includes(this.normalizedColor(color))) return 'Camiseta Gildan 180.09 / 5000';
    return 'Camiseta B&C 032.42 / TG002';
  }

  private falkRossOrderNote(comment?: string) {
    const base = `Mitaller: aplicar precios acordados. ${FALKROSS_PRICE_NOTE}`;
    const cleanComment = comment?.trim().replace(/\s+/g, ' ').slice(0, 500);
    return cleanComment ? `${base} | Comentario: ${cleanComment}` : base;
  }

  private async ensureExtraPurchaseThreeXLStockItems(
    matrix: Awaited<ReturnType<PurchaseService['getPurchaseMatrix']>>,
    supplierArticles: Array<{
      supplierSku: string;
      styleCode: string | null;
      productName: string;
      color: string | null;
      size: string | null;
      purchasePrice: Prisma.Decimal | null;
    }>,
    supplierStocks: Array<{ supplierSku: string }>
  ) {
    const articleBySku = new Map(supplierArticles.map((article) => [article.supplierSku, article]));
    let createdAny = false;

    for (const group of matrix.groups.filter((entry) => ['CAMISETA', 'SUDADERA'].includes(entry.garmentType))) {
      const currentThreeXL = group.sizes.find((entry) => entry.size === '3XL');
      if (currentThreeXL?.stockItemId) continue;

      const template = group.sizes.find((entry) => entry.stockItemId && entry.sku && entry.supplierSku);
      if (!template?.sku) continue;

      const article = this.resolveFalkRossArticle(
        group.garmentType,
        group.color,
        '3XL',
        null,
        supplierArticles,
        articleBySku
      ) ?? this.resolveFalkRossStockOnlyFallback(group.garmentType, group.color, '3XL', supplierStocks);
      if (!article) continue;

      const existing = await this.prisma.stockItem.findFirst({
        where: {
          type: 'BLANK_GARMENT',
          OR: [
            { supplierSku: article.supplierSku },
            { sku: template.sku.replace(/-(?:3XL|XXXL|2XL|XXL|XL|L|M|S)$/i, '-3XL') }
          ]
        }
      });
      if (existing) continue;

      const sku = template.sku.replace(/-(?:3XL|XXXL|2XL|XXL|XL|L|M|S)$/i, '-3XL');
      const fallbackName = `${group.garmentType === 'SUDADERA' ? 'Sudadera' : 'Camiseta'} ${group.color} - 3XL`;
      const stockItemData = {
        name: this.falkRossLineName(group.garmentType, group.color, '3XL', fallbackName),
        type: 'BLANK_GARMENT' as const,
        color: group.color,
        size: '3XL',
        supplierSku: article.supplierSku,
        minStock: 0
      };
      await this.prisma.stockItem.upsert({
        where: { sku },
        update: stockItemData,
        create: {
          sku,
          ...stockItemData
        }
      });
      createdAny = true;
    }

    return createdAny;
  }

  private normalizedColor(value: string) {
    const normalized = this.normalizedToken(value);
    const rules: Array<[string, RegExp]> = [
      ['BLANCA', /\b(blanca|blanco|white)\b/],
      ['NEGRA', /\b(negra|negro|black)\b/],
      ['SAND', /\b(sand|mastic|arena)\b/],
      ['CHARCOAL', /\b(charcoal|darkgrey|darkgray|gris|carbon)\b/],
      ['TANGERINE', /\b(tangerine|orange|naranja)\b/],
      ['AZUL', /\b(azul|blue)\b/],
      ['MARRON', /\b(marron|brown|maroon|dark chocolate|chocolate|tan)\b/],
      ['ROSA', /\b(rosa|pink)\b/],
      ['NAVY', /\b(navy|marino)\b/]
    ];
    return rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? normalized.toUpperCase();
  }

  private normalizedSize(value: string) {
    const normalized = this.normalizedToken(value).toUpperCase();
    const match = normalized.match(/(^|[^A-Z])(3XL|XXXL|2XL|XXL|XL|L|M|S)([^A-Z]|$)/);
    const size = match?.[2] ?? normalized;
    if (size === 'XXXL') return '3XL';
    return size === '2XL' ? 'XXL' : size;
  }

  private normalizedToken(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private todayStart() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private orderNumber(orderDate: Date) {
    const yyyy = orderDate.getFullYear();
    const mm = String(orderDate.getMonth() + 1).padStart(2, '0');
    const dd = String(orderDate.getDate()).padStart(2, '0');
    return `FR-${yyyy}${mm}${dd}`;
  }

  private extraOrderNumber(date: Date) {
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    return `FRX-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(date.getMilliseconds(), 3)}`;
  }
}
