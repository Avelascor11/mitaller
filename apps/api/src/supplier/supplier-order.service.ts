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
  'Camiseta 032.42 -> 2.73 EUR',
  'Camiseta Gildan 180.09 -> revisar tarifa Falk & Ross',
  'Sudadera 290.09 -> 7.30 EUR',
  'Sudadera 237.42 -> 6.60 EUR',
  'Sudadera 240.42 -> 6.00 EUR'
].join(' | ');

const FALKROSS_STYLE_PRICES: Record<string, string> = {
  '03242': '2.73',
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

  async generateDailyFalkRossOrder(options: { submit?: boolean; source?: string } = {}) {
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
    const pendingByStockItemId = await this.pendingSupplierOrderQuantityByStockItemId();
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
        const article = this.resolveFalkRossArticle(group.garmentType, group.color, entry.size, entry.supplierSku, supplierArticles, articleBySku);
        const expectedStyles = this.expectedFalkRossStyles(group.garmentType, group.color);
        const supplierSku = article?.supplierSku ?? expectedStyles[0] ?? entry.supplierSku!;
        const resolvedStyleKey = this.falkRossStyleKey(article?.styleCode ?? article?.productName ?? expectedStyles[0]);
        const supplierStock = article ? stockBySku.get(supplierSku) : null;
        const supplierAvailableQuantity = supplierStock?.availableQuantity ?? null;
        const alreadyPending = pendingByStockItemId.get(entry.stockItemId!) ?? 0;
        const requestedQuantity = Math.max(0, entry.recommendedPurchaseQuantity - alreadyPending);
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
          purchasePrice: article?.purchasePrice ?? FALKROSS_STYLE_PRICES[resolvedStyleKey] ?? null,
          rawDataJson: {
            pendingOrderNeed: entry.pendingOrderNeed,
            currentInternalStock: entry.currentInternalStock,
            minStockTarget: entry.minStockTarget,
            recommendedPurchaseQuantity: entry.recommendedPurchaseQuantity,
            alreadyPendingSupplierOrderQuantity: alreadyPending,
            stockItemSupplierSku: entry.supplierSku,
            resolvedSupplierSku: supplierSku,
            resolvedStyleCode: article?.styleCode,
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

  async submitPurchaseOrder(id: string) {
    const order = await this.prisma.supplierPurchaseOrder.findUnique({
      where: { id },
      include: { lines: true }
    });
    if (!order) throw new BadRequestException('Pedido a proveedor no encontrado');
    if (!order.lines.length) throw new BadRequestException('El pedido a proveedor no tiene lineas');
    if (order.status === 'SUBMITTED') return { status: 'already_submitted', order: this.withOrderNote(order), lines: order.lines };
    if (this.hasUnresolvedFalkRossSkus(order.lines)) {
      throw new BadRequestException('Falta importar el catalogo real de Falk & Ross antes de enviar el pedido al proveedor');
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

  private withOrderNote<T extends { rawRequestJson: Prisma.JsonValue | null }>(order: T) {
    const rawRequest = order.rawRequestJson as SupplierPurchaseOrderPayload | null;
    return {
      ...order,
      orderNote: rawRequest?.orderNote ?? this.falkRossOrderNote()
    };
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

  private hasUnresolvedFalkRossSkus(lines: Array<{ supplierSku: string; rawDataJson: Prisma.JsonValue | null }>) {
    return lines.some((line) => {
      const rawData = line.rawDataJson as { resolvedStyleCode?: string | null } | null;
      return !rawData?.resolvedStyleCode;
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
    if (expectedColor === 'AZUL') return this.normalizedToken(articleColor).includes('royal blue');
    if (expectedColor === 'SAND') return this.normalizedToken(articleColor).includes('mastic');
    if (expectedColor === 'ROSA') return this.normalizedToken(articleColor).includes('azalea');
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
    if (normalized === 'ROSA') return 'Azalea';
    if (normalized === 'MARRON') return 'Dark Chocolate';
    return null;
  }

  private articleMatchesStyle(article: { styleCode: string | null; productName: string }, expectedStyles: string[]) {
    const haystack = this.normalizedToken(`${article.styleCode ?? ''} ${article.productName}`);
    return expectedStyles.some((style) => haystack.includes(this.normalizedToken(style)));
  }

  private expectedFalkRossStyles(garmentType: string, color: string) {
    if (garmentType === 'SUDADERA') return ['WG005', '237.42', '23742'];
    if (['MARRON', 'ROSA'].includes(this.normalizedColor(color))) return ['5000', '180.09', '18009'];
    return ['TG002', '032.42', '03242'];
  }

  private falkRossStyleKey(value: string) {
    const normalized = this.normalizedToken(value).replace(/\s/g, '');
    if (normalized.includes('03242') || normalized.includes('tg002')) return '03242';
    if (normalized.includes('23742') || normalized.includes('wg005')) return '23742';
    if (normalized.includes('24042')) return '24042';
    if (normalized.includes('29009')) return '29009';
    if (normalized.includes('18009') || normalized === '5000') return '18009';
    if (normalized.includes('10209') || normalized === '2000') return '10209';
    return normalized;
  }

  private falkRossOrderNote() {
    return `Mitaller: revisar precios antes de confirmar. ${FALKROSS_PRICE_NOTE}`;
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
    const match = normalized.match(/(^|[^A-Z])(2XL|XXL|XL|L|M|S)([^A-Z]|$)/);
    const size = match?.[2] ?? normalized;
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
}
