import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { OperationalStatus, Prisma, StockItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PurchaseService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  calculateRecommendedPurchaseQuantity(input: {
    pendingOrderNeed: number;
    minStockTarget: number;
    forecastNeed?: number;
    currentInternalStock: number;
    alreadyOrderedQuantity: number;
  }) {
    return Math.max(0, input.pendingOrderNeed + input.minStockTarget + (input.forecastNeed ?? 0) - input.currentInternalStock - input.alreadyOrderedQuantity);
  }

  getTodayNeeds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.prisma.purchaseNeed.findMany({
      where: { generatedAt: { gte: start } },
      include: { stockItem: true },
      orderBy: { recommendedPurchaseQuantity: 'desc' }
    });
  }

  async markRecommendedAsOrdered() {
    const matrix = await this.getPurchaseMatrix();
    const opened = [];
    for (const group of matrix.groups) {
      for (const entry of group.sizes) {
        if (!entry.stockItemId || entry.recommendedPurchaseQuantity <= 0) continue;
        opened.push(await this.prisma.purchaseNeed.create({
          data: {
            stockItemId: entry.stockItemId,
            supplierSku: entry.supplierSku,
            neededForPendingOrders: entry.pendingOrderNeed,
            minStockTarget: entry.minStockTarget,
            currentInternalStock: entry.currentInternalStock,
            alreadyOrderedQuantity: entry.alreadyOrderedQuantity,
            recommendedPurchaseQuantity: entry.recommendedPurchaseQuantity,
            supplierAvailableQuantity: entry.supplierAvailableQuantity,
            status: 'ORDERED'
          }
        }));
      }
    }
    return { ordered: opened.length, lines: opened };
  }

  async receivePurchaseLines(lines: Array<{ stockItemId: string; quantity: number }>) {
    const cleanLines = lines.filter((line) => line.stockItemId && Number.isInteger(line.quantity) && line.quantity > 0);
    if (!cleanLines.length) throw new BadRequestException('No hay lineas validas para recibir');
    const location = await this.prisma.stockLocation.findUniqueOrThrow({ where: { code: 'EST-A-01' } });

    return this.prisma.$transaction(async (tx) => {
      const received = [];
      for (const line of cleanLines) {
        const stockItem = await tx.stockItem.findUniqueOrThrow({ where: { id: line.stockItemId } });
        await tx.stockLevel.upsert({
          where: { stockItemId_locationId: { stockItemId: line.stockItemId, locationId: location.id } },
          create: { stockItemId: line.stockItemId, locationId: location.id, quantity: line.quantity },
          update: { quantity: { increment: line.quantity } }
        });
        await tx.stockMovement.create({
          data: {
            stockItemId: line.stockItemId,
            toLocationId: location.id,
            quantity: line.quantity,
            reason: 'COMPRA_RECIBIDA'
          }
        });
        await tx.activityLog.create({
          data: {
            entityType: 'StockItem',
            entityId: line.stockItemId,
            action: 'PURCHASE_RECEIVED',
            message: `${line.quantity} unidades recibidas de ${stockItem.name}`,
            metadataJson: { stockItemId: line.stockItemId, sku: stockItem.sku, quantity: line.quantity }
          }
        });
        received.push({ stockItemId: line.stockItemId, sku: stockItem.sku, name: stockItem.name, quantity: line.quantity });
      }

      for (const line of cleanLines) {
        const ordered = await tx.purchaseNeed.findMany({
          where: { stockItemId: line.stockItemId, status: 'ORDERED' },
          orderBy: { generatedAt: 'asc' }
        });
        let remaining = line.quantity;
        for (const need of ordered) {
          if (remaining <= 0) break;
          await tx.purchaseNeed.update({ where: { id: need.id }, data: { status: 'RECEIVED' } });
          remaining -= need.recommendedPurchaseQuantity;
        }
      }

      return { received: received.length, lines: received };
    });
  }

  async getOrderPickingList(orderId: string) {
    const [order, productMappings, stockItems] = await Promise.all([
      this.prisma.order.findFirstOrThrow({
        where: { OR: [{ id: orderId }, { orderNumber: orderId }, { shopifyOrderId: orderId }] },
        include: { items: true }
      }),
      this.prisma.productSubproductMapping.findMany(),
      this.prisma.stockItem.findMany({ where: { type: 'BLANK_GARMENT' }, include: { levels: true } })
    ]);
    const mappingIndex = this.buildMappingIndex(productMappings);
    const stockIndex = new Map<string, StockItemWithLevels>();
    for (const item of stockItems) {
      const kind = this.inferGarmentKind(`${item.name} ${item.sku} ${item.supplierSku ?? ''}`);
      const color = this.normalizeColor(item.color ?? item.name);
      const size = this.normalizeSize(item.size ?? item.name);
      if (kind && color && size) stockIndex.set(this.matrixKey(kind, color, size), item);
    }
    const lines = new Map<string, PickingListLine>();
    const unmapped = [];
    for (const item of order.items) {
      const mapped = this.mapOrderItemToBlankGarment(item, mappingIndex);
      if (!mapped) {
        unmapped.push({ orderItemId: item.id, title: item.title, sku: item.sku, quantity: item.quantity });
        continue;
      }
      const key = this.matrixKey(mapped.kind, mapped.color, mapped.size);
      const stockItem = stockIndex.get(key);
      const current = lines.get(key) ?? {
        key,
        kind: mapped.kind,
        color: mapped.color,
        size: mapped.size,
        subproductName: mapped.subproductName,
        sku: stockItem?.sku ?? null,
        stockItemId: stockItem?.id ?? null,
        stockAvailable: stockItem?.levels.reduce((sum, level) => sum + level.quantity, 0) ?? 0,
        quantity: 0,
        orderItems: []
      };
      current.quantity += item.quantity;
      current.orderItems.push({ id: item.id, title: item.title, quantity: item.quantity, sku: item.sku });
      lines.set(key, current);
    }
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      lines: [...lines.values()].sort((left, right) => left.subproductName.localeCompare(right.subproductName)),
      unmapped
    };
  }

  async importProductMappings(mappings: ProductSubproductMappingInput[]) {
    const cleanMappings = mappings
      .map((mapping) => ({
        productName: mapping.productName?.trim(),
        productType: mapping.productType?.trim() || null,
        color: mapping.color?.trim() || null,
        size: mapping.size?.trim() || null,
        sku: mapping.sku?.trim() || '',
        subproductName: mapping.subproductName?.trim(),
        imageRef: mapping.imageRef?.trim() || null
      }))
      .filter((mapping) => mapping.productName && mapping.subproductName);

    const imported = [];
    for (const mapping of cleanMappings) {
      imported.push(await this.prisma.productSubproductMapping.upsert({
        where: { productName: mapping.productName },
        update: {
          productType: mapping.productType,
          color: mapping.color,
          size: mapping.size,
          sku: mapping.sku,
          subproductName: mapping.subproductName,
          imageRef: mapping.imageRef,
          source: 'MEJOR PRODUCCION/PRODUCTOS'
        },
        create: {
          productName: mapping.productName,
          productType: mapping.productType,
          color: mapping.color,
          size: mapping.size,
          sku: mapping.sku,
          subproductName: mapping.subproductName,
          imageRef: mapping.imageRef,
          source: 'MEJOR PRODUCCION/PRODUCTOS'
        }
      }));
    }

    return { received: mappings.length, imported: imported.length };
  }

  getProductMappings() {
    return this.prisma.productSubproductMapping.findMany({
      orderBy: [{ productName: 'asc' }]
    });
  }

  async saveProductMapping(mapping: ProductSubproductMappingInput) {
    const clean = this.cleanProductMapping(mapping);
    if (!clean.productName || !clean.subproductName) {
      throw new BadRequestException('productName y subproductName son obligatorios');
    }
    return this.prisma.productSubproductMapping.upsert({
      where: { productName: clean.productName },
      update: {
        productType: clean.productType,
        color: clean.color,
        size: clean.size,
        sku: clean.sku,
        subproductName: clean.subproductName,
        imageRef: clean.imageRef,
        source: 'APP'
      },
      create: {
        productName: clean.productName,
        productType: clean.productType,
        color: clean.color,
        size: clean.size,
        sku: clean.sku,
        subproductName: clean.subproductName,
        imageRef: clean.imageRef,
        source: 'APP'
      }
    });
  }

  async getMappingWorkbench() {
    const pendingStatuses: OperationalStatus[] = [
      OperationalStatus.NEW,
      OperationalStatus.WAITING_STOCK,
      OperationalStatus.WAITING_PRODUCTION,
      OperationalStatus.IN_PRODUCTION,
      OperationalStatus.PRODUCED,
      OperationalStatus.WAITING_PICKING,
      OperationalStatus.PICKED,
      OperationalStatus.BLOCKED
    ];
    const [mappings, stockItems, orderItems] = await Promise.all([
      this.prisma.productSubproductMapping.findMany({ orderBy: [{ productName: 'asc' }] }),
      this.prisma.stockItem.findMany({
        where: { type: 'BLANK_GARMENT' },
        orderBy: [{ name: 'asc' }]
      }),
      this.prisma.orderItem.findMany({
        where: {
          order: { operationalStatus: { in: pendingStatuses } },
          status: { not: 'CANCELLED' }
        },
        include: { order: true }
      })
    ]);
    const mappingIndex = this.buildMappingIndex(mappings);
    const unmapped = new Map<string, UnmappedProduct>();

    for (const item of this.filterByMinimumOrderNumber(orderItems)) {
      const titleKey = `name:${this.normalizeText(item.title)}`;
      const skuKey = this.isReliableSku(item.sku) ? `sku:${item.sku}` : '';
      if (mappingIndex.has(titleKey) || (skuKey && mappingIndex.has(skuKey))) continue;

      const key = this.isReliableSku(item.sku) ? `sku:${item.sku}` : `name:${this.normalizeText(item.title)}`;
      const current = unmapped.get(key) ?? {
        key,
        productName: item.title,
        sku: this.isReliableSku(item.sku) ? item.sku : '',
        productType: item.productType,
        color: item.color,
        size: item.size,
        variantTitle: item.variantTitle,
        pendingQuantity: 0,
        orderNumbers: []
      };
      current.pendingQuantity += item.quantity;
      if (!current.orderNumbers.includes(item.order.orderNumber)) current.orderNumbers.push(item.order.orderNumber);
      unmapped.set(key, current);
    }

    return {
      mappings,
      stockItems: stockItems.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        color: item.color,
        size: item.size,
        supplierSku: item.supplierSku
      })),
      unmapped: [...unmapped.values()].sort((left, right) => right.pendingQuantity - left.pendingQuantity)
    };
  }

  private cleanProductMapping(mapping: ProductSubproductMappingInput) {
    return {
      productName: mapping.productName?.trim(),
      productType: mapping.productType?.trim() || null,
      color: mapping.color?.trim() || null,
      size: mapping.size?.trim() || null,
      sku: mapping.sku?.trim() || '',
      subproductName: mapping.subproductName?.trim(),
      imageRef: mapping.imageRef?.trim() || null
    };
  }

  async getPurchaseMatrix() {
    const sizes = ['S', 'M', 'L', 'XL', 'XXL'];
    const pendingStatuses: OperationalStatus[] = [
      OperationalStatus.NEW,
      OperationalStatus.WAITING_STOCK,
      OperationalStatus.WAITING_PRODUCTION,
      OperationalStatus.IN_PRODUCTION,
      OperationalStatus.PRODUCED,
      OperationalStatus.WAITING_PICKING,
      OperationalStatus.PICKED,
      OperationalStatus.BLOCKED
    ];
    const [stockItems, orderItems, supplierStocks, productMappings, orderedNeeds] = await Promise.all([
      this.prisma.stockItem.findMany({
        where: { type: 'BLANK_GARMENT' },
        include: { levels: true }
      }),
      this.prisma.orderItem.findMany({
        where: {
          order: { operationalStatus: { in: pendingStatuses } },
          status: { not: 'CANCELLED' }
        },
        include: { order: true }
      }),
      this.prisma.supplierStock.findMany(),
      this.prisma.productSubproductMapping.findMany(),
      this.prisma.purchaseNeed.findMany({ where: { status: 'ORDERED' } })
    ]);
    const mappingIndex = this.buildMappingIndex(productMappings);

    const stockIndex = new Map<string, StockItemWithLevels>();
    for (const item of stockItems) {
      const kind = this.inferGarmentKind(`${item.name} ${item.sku} ${item.supplierSku ?? ''}`);
      const color = this.normalizeColor(item.color ?? item.name);
      const size = this.normalizeSize(item.size ?? item.name);
      if (!kind || !color || !size) continue;
      stockIndex.set(this.matrixKey(kind, color, size), item);
    }

    const demand = new Map<string, MatrixDemand>();
    for (const item of this.filterByMinimumOrderNumber(orderItems)) {
      const mapped = this.mapOrderItemToBlankGarment(item, mappingIndex);
      if (!mapped) continue;
      const { kind, color, size } = mapped;
      const key = this.matrixKey(kind, color, size);
      const current = demand.get(key) ?? { kind, color, size, quantity: 0, orders: [] };
      current.quantity += item.quantity;
      current.orders.push({
        orderId: item.orderId,
        orderNumber: item.order.orderNumber,
        customerName: item.order.customerName,
        orderItemId: item.id,
        title: item.title,
        sku: item.sku,
        quantity: item.quantity
      });
      demand.set(key, current);
    }

    const groups = new Map<string, PurchaseMatrixGroup>();
    const allKeys = new Set([...stockIndex.keys(), ...demand.keys()]);
    for (const key of allKeys) {
      const stockItem = stockIndex.get(key);
      const need = demand.get(key);
      const kind = need?.kind ?? this.inferGarmentKind(`${stockItem?.name ?? ''} ${stockItem?.sku ?? ''}`) ?? 'CAMISETA';
      const color = need?.color ?? this.normalizeColor(stockItem?.color ?? stockItem?.name ?? '') ?? 'SIN_COLOR';
      const size = need?.size ?? this.normalizeSize(stockItem?.size ?? stockItem?.name ?? '') ?? 'SIN_TALLA';
      const currentInternalStock = stockItem?.levels.reduce((sum, level) => sum + level.quantity, 0) ?? 0;
      const minStockTarget = stockItem?.minStock ?? 0;
      const pendingOrderNeed = need?.quantity ?? 0;
      const alreadyOrderedQuantity = stockItem
        ? orderedNeeds
          .filter((ordered) => ordered.stockItemId === stockItem.id)
          .reduce((sum, ordered) => sum + ordered.recommendedPurchaseQuantity, 0)
        : 0;
      const recommendedPurchaseQuantity = this.calculateRecommendedPurchaseQuantity({
        pendingOrderNeed,
        minStockTarget,
        currentInternalStock,
        alreadyOrderedQuantity
      });
      const supplierAvailableQuantity = supplierStocks.find((stock) => stock.supplierSku === stockItem?.supplierSku)?.availableQuantity ?? null;
      const groupKey = this.matrixKey(kind, color, '');
      const group = groups.get(groupKey) ?? {
        key: groupKey,
        garmentType: kind,
        color,
        title: `${kind === 'SUDADERA' ? 'SUDADERAS' : 'CAMISETAS'} ${this.colorLabel(color)}`,
        theme: this.colorTheme(color),
        sizes: []
      };
      group.sizes.push({
        size,
        subproductName: `${kind === 'SUDADERA' ? 'Sudadera' : 'Camiseta'} ${this.colorSingularLabel(color)} - ${size}`,
        sku: stockItem?.sku ?? null,
        supplierSku: stockItem?.supplierSku ?? null,
        stockItemId: stockItem?.id ?? null,
        pendingOrderNeed,
        demandOrders: need?.orders ?? [],
        currentInternalStock,
        minStockTarget,
        alreadyOrderedQuantity,
        recommendedPurchaseQuantity,
        supplierAvailableQuantity
      });
      groups.set(groupKey, group);
    }

    const result = [...groups.values()]
      .map((group) => ({
        ...group,
        sizes: sizes.map((size) => group.sizes.find((entry) => entry.size === size) ?? {
          size,
          subproductName: `${group.garmentType === 'SUDADERA' ? 'Sudadera' : 'Camiseta'} ${this.colorSingularLabel(group.color)} - ${size}`,
          sku: null,
          supplierSku: null,
          stockItemId: null,
          pendingOrderNeed: 0,
          demandOrders: [],
          currentInternalStock: 0,
          minStockTarget: 0,
          alreadyOrderedQuantity: 0,
          recommendedPurchaseQuantity: 0,
          supplierAvailableQuantity: null
        })
      }))
      .sort((left, right) => {
        if (left.garmentType === right.garmentType) return left.color.localeCompare(right.color);
        return left.garmentType.localeCompare(right.garmentType);
      });

    return {
      sizes,
      generatedAt: new Date(),
      groups: result
    };
  }

  @Cron('0 6 * * *')
  async generateDailyPurchaseNeeds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const pendingStatuses: OperationalStatus[] = [
      OperationalStatus.NEW,
      OperationalStatus.WAITING_STOCK,
      OperationalStatus.WAITING_PRODUCTION,
      OperationalStatus.IN_PRODUCTION,
      OperationalStatus.PRODUCED,
      OperationalStatus.WAITING_PICKING,
      OperationalStatus.PICKED,
      OperationalStatus.BLOCKED
    ];
    const [stockItems, supplierStocks, pendingOrderItems, productMappings] = await Promise.all([
      this.prisma.stockItem.findMany({ where: { type: 'BLANK_GARMENT' }, include: { levels: true } }),
      this.prisma.supplierStock.findMany(),
      this.prisma.orderItem.findMany({
        where: {
          order: { operationalStatus: { in: pendingStatuses } },
          status: { not: 'CANCELLED' }
        },
        include: { order: true }
      }),
      this.prisma.productSubproductMapping.findMany()
    ]);
    const mappingIndex = this.buildMappingIndex(productMappings);
    const demand = new Map<string, number>();
    for (const orderItem of this.filterByMinimumOrderNumber(pendingOrderItems)) {
      const mapped = this.mapOrderItemToBlankGarment(orderItem, mappingIndex);
      if (!mapped) continue;
      const key = this.matrixKey(mapped.kind, mapped.color, mapped.size);
      demand.set(key, (demand.get(key) ?? 0) + orderItem.quantity);
    }
    const created = [];
    await this.prisma.purchaseNeed.deleteMany({ where: { generatedAt: { gte: start }, status: 'OPEN' } });

    for (const item of stockItems) {
      const kind = this.inferGarmentKind(`${item.name} ${item.sku} ${item.supplierSku ?? ''}`);
      const color = this.normalizeColor(item.color ?? item.name);
      const size = this.normalizeSize(item.size ?? item.name);
      if (!kind || !color || !size) continue;
      const key = this.matrixKey(kind, color, size);
      const currentInternalStock = item.levels.reduce((sum, level) => sum + level.quantity, 0);
      const neededForPendingOrders = demand.get(key) ?? 0;
      const supplierAvailableQuantity = supplierStocks.find((stock) => stock.supplierSku === item.supplierSku)?.availableQuantity;
      const recommendedPurchaseQuantity = this.calculateRecommendedPurchaseQuantity({
        pendingOrderNeed: neededForPendingOrders,
        minStockTarget: item.minStock,
        currentInternalStock,
        alreadyOrderedQuantity: 0
      });
      if (recommendedPurchaseQuantity === 0) continue;
      created.push(await this.prisma.purchaseNeed.create({
        data: {
          stockItemId: item.id,
          supplierSku: item.supplierSku,
          neededForPendingOrders,
          minStockTarget: item.minStock,
          currentInternalStock,
          alreadyOrderedQuantity: 0,
          recommendedPurchaseQuantity,
          supplierAvailableQuantity
        }
      }));
    }

    return { generated: created.length, needs: created };
  }

  private buildMappingIndex(mappings: Array<{ sku: string; productName: string; subproductName: string }>) {
    const index = new Map<string, string>();
    for (const mapping of mappings) {
      index.set(`sku:${mapping.sku}`, mapping.subproductName);
      index.set(`name:${this.normalizeText(mapping.productName)}`, mapping.subproductName);
    }
    return index;
  }

  private mapOrderItemToBlankGarment(item: { productType?: string | null; title: string; sku: string; color?: string | null; size?: string | null; variantTitle?: string | null }, mappingIndex?: Map<string, string>) {
    const mappedSubproduct = mappingIndex?.get(`name:${this.normalizeText(item.title)}`) ?? (this.isReliableSku(item.sku) ? mappingIndex?.get(`sku:${item.sku}`) : undefined);
    if (mappedSubproduct) {
      const mapped = this.mapSubproductName(mappedSubproduct);
      if (mapped) return mapped;
    }

    const direct = this.mapDirectProductAttributes(item);
    if (direct) return direct;

    const kind = this.inferGarmentKind(`${item.productType ?? ''} ${item.title} ${item.sku}`);
    const color = this.normalizeColor(`${item.color ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    const size = this.normalizeSize(`${item.size ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    if (!kind || !color || !size) return null;
    return {
      kind,
      color,
      size,
      subproductName: `${kind === 'SUDADERA' ? 'Sudadera' : 'Camiseta'} ${this.colorSingularLabel(color)} - ${size}`
    };
  }

  private mapDirectProductAttributes(item: { productType?: string | null; title: string; color?: string | null; size?: string | null; variantTitle?: string | null }) {
    const kind = this.inferGarmentKind(`${item.productType ?? ''} ${item.title}`);
    const color = this.normalizeColor(`${item.color ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    const size = this.normalizeSize(`${item.size ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    if (!kind || !color || !size) return null;
    return {
      kind,
      color,
      size,
      subproductName: `${kind === 'SUDADERA' ? 'Sudadera' : 'Camiseta'} ${this.colorSingularLabel(color)} - ${size}`
    };
  }

  private mapSubproductName(subproductName: string) {
    const kind = this.inferGarmentKind(subproductName);
    const color = this.normalizeColor(subproductName);
    const size = this.normalizeSize(subproductName);
    if (!kind || !color || !size) return null;
    return { kind, color, size, subproductName };
  }

  private matrixKey(kind: string, color: string, size: string) {
    return `${kind}:${color}:${size}`;
  }

  private isReliableSku(sku: string) {
    const normalized = sku.trim().toUpperCase();
    return Boolean(normalized) && !normalized.startsWith('WRONG-') && !normalized.startsWith('NO-SKU');
  }

  private filterByMinimumOrderNumber<T extends { order: { orderNumber: string; shopifyOrderId?: string } }>(items: T[]) {
    const minimum = Number(this.config.get('SHOPIFY_MIN_ORDER_NUMBER') ?? 0);
    if (!minimum) return items;
    return items.filter((item) =>
      item.order.shopifyOrderId?.startsWith('sheet:') ||
      this.orderNumberValue(item.order.orderNumber) >= minimum
    );
  }

  private orderNumberValue(orderNumber: string) {
    return Number(orderNumber.replace(/\D/g, '')) || 0;
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
      ['SAND', /\b(sand|arena)\b/],
      ['CHARCOAL', /\b(charcoal|carbon|gris)\b/],
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

  private colorLabel(color: string) {
    const labels: Record<string, string> = {
      BLANCA: 'BLANCAS',
      NEGRA: 'NEGRAS',
      MARRON: 'MARRON'
    };
    return labels[color] ?? color;
  }

  private colorSingularLabel(color: string) {
    const labels: Record<string, string> = {
      BLANCA: 'Blanca',
      NEGRA: 'Negra',
      SAND: 'Sand',
      CHARCOAL: 'Charcoal',
      TANGERINE: 'Tangerine',
      AZUL: 'Azul',
      MARRON: 'Marron',
      ROSA: 'Rosa',
      NAVY: 'Navy'
    };
    return labels[color] ?? color;
  }

  private colorTheme(color: string) {
    const themes: Record<string, { background: string; foreground: string }> = {
      BLANCA: { background: '#FFFFFF', foreground: '#111111' },
      NEGRA: { background: '#000000', foreground: '#FFFFFF' },
      SAND: { background: '#FFF2C9', foreground: '#111111' },
      CHARCOAL: { background: '#E8E8E8', foreground: '#111111' },
      TANGERINE: { background: '#FF6A00', foreground: '#111111' },
      AZUL: { background: '#3E8BC4', foreground: '#111111' },
      MARRON: { background: '#7A3F00', foreground: '#111111' },
      ROSA: { background: '#D5A4BC', foreground: '#111111' },
      NAVY: { background: '#0B416A', foreground: '#FFFFFF' }
    };
    return themes[color] ?? { background: '#F2F2F7', foreground: '#111111' };
  }
}

type StockItemWithLevels = StockItem & {
  levels: Array<{ quantity: number }>;
};

interface MatrixDemand {
  kind: string;
  color: string;
  size: string;
  quantity: number;
  orders: PurchaseMatrixDemandOrder[];
}

interface PurchaseMatrixDemandOrder {
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderItemId: string;
  title: string;
  sku: string;
  quantity: number;
}

interface PickingListLine {
  key: string;
  kind: string;
  color: string;
  size: string;
  subproductName: string;
  sku: string | null;
  stockItemId: string | null;
  stockAvailable: number;
  quantity: number;
  orderItems: Array<{ id: string; title: string; sku: string; quantity: number }>;
}

interface ProductSubproductMappingInput {
  productName: string;
  productType?: string;
  color?: string;
  size?: string;
  sku?: string;
  subproductName: string;
  imageRef?: string;
}

interface UnmappedProduct {
  key: string;
  productName: string;
  sku: string;
  productType?: string | null;
  color?: string | null;
  size?: string | null;
  variantTitle?: string | null;
  pendingQuantity: number;
  orderNumbers: string[];
}

interface PurchaseMatrixGroup {
  key: string;
  garmentType: string;
  color: string;
  title: string;
  theme: { background: string; foreground: string };
  sizes: Array<{
    size: string;
    subproductName: string;
    sku: string | null;
    supplierSku: string | null;
    stockItemId: string | null;
    pendingOrderNeed: number;
    demandOrders: PurchaseMatrixDemandOrder[];
    currentInternalStock: number;
    minStockTarget: number;
    alreadyOrderedQuantity: number;
    recommendedPurchaseQuantity: number;
    supplierAvailableQuantity: number | null;
  }>;
}
