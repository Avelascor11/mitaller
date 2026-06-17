import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { OperationalStatus, Prisma, StockItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_SUPPLIER_ORDER_STATUSES = ['SUBMITTED'];

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
    return Math.max(
      0,
      input.pendingOrderNeed
        + input.minStockTarget
        + (input.forecastNeed ?? 0)
        - input.currentInternalStock
    );
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
    const [blankStockItems, transferStockItems, orderItems, supplierStocks, productMappings, orderedQuantities] = await Promise.all([
      this.prisma.stockItem.findMany({
        where: { type: 'BLANK_GARMENT' },
        include: { levels: true }
      }),
      this.prisma.stockItem.findMany({
        where: { type: 'TRANSFER' },
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
      this.pendingSupplierOrderQuantityByStockItemId()
    ]);
    const mappingIndex = this.buildMappingIndex(productMappings);

    const stockIndex = new Map<string, StockItemWithLevels>();
    for (const item of blankStockItems) {
      const kind = this.inferGarmentKind(`${item.name} ${item.sku} ${item.supplierSku ?? ''}`);
      const color = this.normalizeColor(item.color ?? item.name);
      const size = this.normalizeSize(item.size ?? item.name);
      if (!kind || !color || !size) continue;
      stockIndex.set(this.matrixKey(kind, color, size), item);
    }

    const demand = new Map<string, MatrixDemand>();
    const dtfDemand = new Map<string, MatrixDemand>();
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

      const dtfDesign = this.mapOrderItemToDtfDesign({ ...item, imageRef: this.firstImageRef(item) }, mapped);
      if (dtfDesign) {
        const dtfKey = this.dtfKey(dtfDesign.slug);
        const dtfCurrent = dtfDemand.get(dtfKey) ?? {
          kind: 'DTF',
          color: 'EXTERNO',
          size: dtfDesign.slug,
          quantity: 0,
          orders: [],
          label: dtfDesign.label,
          imageRef: dtfDesign.imageRef
        };
        if (!dtfCurrent.imageRef && dtfDesign.imageRef) dtfCurrent.imageRef = dtfDesign.imageRef;
        dtfCurrent.quantity += item.quantity;
        dtfCurrent.orders.push({
          orderId: item.orderId,
          orderNumber: item.order.orderNumber,
          customerName: item.order.customerName,
          orderItemId: item.id,
          title: item.title,
          sku: item.sku,
          quantity: item.quantity
        });
        dtfDemand.set(dtfKey, dtfCurrent);
      }
    }
    this.addDtfCatalogFromMappings(dtfDemand, productMappings);

    const transferIndex = await this.ensureDtfStockItems(dtfDemand, transferStockItems);

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
      // "Ya pedido" no se descuenta de la compra: comprar = pedidos pendientes − stock.
      // El stock solo sube cuando se mete el albarán. (Se mantiene a 0 a propósito.)
      const alreadyOrderedQuantity = 0;
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
        title: `${kind === 'SUDADERA' ? 'SUDADERAS' : kind === 'BAÑADOR' ? 'BAÑADORES' : 'CAMISETAS'} ${this.colorLabel(color)}`,
        theme: this.colorTheme(color),
        sizes: []
      };
      group.sizes.push({
        size,
        subproductName: `${this.kindLabel(kind)} ${this.colorSingularLabel(color)} - ${size}`,
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

    const dtfGroup = this.buildDtfGroup(dtfDemand, transferIndex, new Map(), supplierStocks);
    if (dtfGroup.sizes.length) groups.set(dtfGroup.key, dtfGroup);

    const result = [...groups.values()]
      .map((group) => ({
        ...group,
        sizes: group.garmentType === 'DTF' ? group.sizes.sort((left, right) => left.subproductName.localeCompare(right.subproductName)) : sizes.map((size) => group.sizes.find((entry) => entry.size === size) ?? {
          size,
          subproductName: `${this.kindLabel(group.garmentType)} ${this.colorSingularLabel(group.color)} - ${size}`,
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
        if (left.garmentType === 'DTF') return 1;
        if (right.garmentType === 'DTF') return -1;
        if (left.garmentType === right.garmentType) return left.color.localeCompare(right.color);
        return left.garmentType.localeCompare(right.garmentType);
      });

    return {
      sizes,
      generatedAt: new Date(),
      groups: result
    };
  }

  async getFulfillableOrders() {
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

    const [blankStockItems, transferStockItems, productMappings, orders] = await Promise.all([
      this.prisma.stockItem.findMany({ where: { type: 'BLANK_GARMENT' }, include: { levels: true } }),
      this.prisma.stockItem.findMany({ where: { type: 'TRANSFER', sku: { startsWith: 'DTF-' } }, include: { levels: true } }),
      this.prisma.productSubproductMapping.findMany(),
      this.prisma.order.findMany({
        where: { operationalStatus: { in: pendingStatuses } },
        include: { items: { where: { status: { not: 'CANCELLED' } } } },
        orderBy: { orderedAt: 'asc' }
      })
    ]);

    const mappingIndex = this.buildMappingIndex(productMappings);
    const stockIndex = new Map<string, { id: string; available: number; name: string }>();
    for (const item of blankStockItems) {
      const kind = this.inferGarmentKind(`${item.name} ${item.sku} ${item.supplierSku ?? ''}`);
      const color = this.normalizeColor(item.color ?? item.name);
      const size = this.normalizeSize(item.size ?? item.name);
      if (!kind || !color || !size) continue;
      const key = this.matrixKey(kind, color, size);
      stockIndex.set(key, {
        id: item.id,
        available: item.levels.reduce((sum, l) => sum + l.quantity, 0),
        name: item.name
      });
    }
    const dtfStockIndex = new Map<string, { id: string; available: number; name: string }>();
    for (const item of transferStockItems) {
      dtfStockIndex.set(item.sku, {
        id: item.id,
        available: item.levels.reduce((sum, level) => sum + level.quantity, 0),
        name: item.name
      });
    }

    const result = orders.map((order) => {
      const lines: Array<{
        key: string; subproductName: string; color: string; size: string;
        required: number; available: number; canFulfill: boolean;
      }> = [];
      const unmapped: string[] = [];

      const demand = new Map<string, { subproductName: string; color: string; size: string; required: number }>();
      const dtfDemand = new Map<string, { subproductName: string; color: string; size: string; required: number }>();
      for (const item of order.items) {
        const mapped = this.mapOrderItemToBlankGarment(item, mappingIndex);
        if (!mapped) { unmapped.push(item.title); continue; }
        const key = this.matrixKey(mapped.kind, mapped.color, mapped.size);
        const cur = demand.get(key) ?? { subproductName: mapped.subproductName, color: mapped.color, size: mapped.size, required: 0 };
        cur.required += item.quantity;
        demand.set(key, cur);

        const dtfDesign = this.mapOrderItemToDtfDesign({ ...item, imageRef: this.firstImageRef(item) }, mapped);
        if (dtfDesign) {
          const dtfKey = this.dtfKey(dtfDesign.slug);
          const dtfCurrent = dtfDemand.get(dtfKey) ?? {
            subproductName: `DTF ${dtfDesign.label}`,
            color: 'DTF',
            size: dtfDesign.slug,
            required: 0
          };
          dtfCurrent.required += item.quantity;
          dtfDemand.set(dtfKey, dtfCurrent);
        }
      }

      let fulfillableCount = 0;
      let totalCount = 0;
      for (const [key, d] of demand) {
        const stock = stockIndex.get(key);
        const available = stock?.available ?? 0;
        const canFulfill = available >= d.required;
        if (canFulfill) fulfillableCount += d.required;
        totalCount += d.required;
        lines.push({ key, subproductName: d.subproductName, color: d.color, size: d.size, required: d.required, available, canFulfill });
      }
      for (const [key, d] of dtfDemand) {
        const stock = dtfStockIndex.get(this.dtfSku(d.size));
        const available = stock?.available ?? 0;
        const canFulfill = available >= d.required;
        if (canFulfill) fulfillableCount += d.required;
        totalCount += d.required;
        lines.push({ key, subproductName: d.subproductName, color: d.color, size: d.size, required: d.required, available, canFulfill });
      }

      const fulfillability = totalCount === 0 ? 'NONE'
        : fulfillableCount === totalCount ? 'FULL'
        : fulfillableCount > 0 ? 'PARTIAL'
        : 'NONE';

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customer: order.customerName,
        operationalStatus: order.operationalStatus,
        orderedAt: order.orderedAt,
        fulfillability,
        fulfillableItems: fulfillableCount,
        totalItems: totalCount,
        lines,
        unmapped,
        items: order.items.map((i) => ({
          id: i.id,
          title: i.title,
          variantTitle: i.variantTitle,
          sku: i.sku,
          quantity: i.quantity,
          color: i.color,
          size: i.size,
          unitPrice: i.unitPrice,
          imageUrl: i.imageUrl
        }))
      };
    });

    return {
      orders: result,
      summary: {
        full: result.filter((o) => o.fulfillability === 'FULL').length,
        partial: result.filter((o) => o.fulfillability === 'PARTIAL').length,
        none: result.filter((o) => o.fulfillability === 'NONE').length
      }
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
      const alreadyOrderedQuantity = 0;
      const recommendedPurchaseQuantity = this.calculateRecommendedPurchaseQuantity({
        pendingOrderNeed: neededForPendingOrders,
        minStockTarget: item.minStock,
        currentInternalStock,
        alreadyOrderedQuantity
      });
      if (recommendedPurchaseQuantity === 0) continue;
      created.push(await this.prisma.purchaseNeed.create({
        data: {
          stockItemId: item.id,
          supplierSku: item.supplierSku,
          neededForPendingOrders,
          minStockTarget: item.minStock,
          currentInternalStock,
          alreadyOrderedQuantity,
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

  // Swimsuits ship "por dorsal": title like `Bañador "14"`. Each dorsal = a color.
  private readonly banadorDorsalColor: Record<string, string> = {
    '14': 'VERDE', '55': 'AZUL', '1': 'NAVY', '16': 'ROJO', '4': 'NARANJA'
  };

  private mapBanadorByDorsal(item: { title: string; sku: string; size?: string | null; variantTitle?: string | null; productType?: string | null }) {
    const text = this.normalizeText(`${item.title} ${item.productType ?? ''} ${item.sku}`);
    if (!/banador|swimsuit|swim|bikini/.test(text)) return null;
    const dorsal = `${item.title}`.match(/(\d{1,3})/)?.[1];
    if (!dorsal) return null;
    const color = this.banadorDorsalColor[dorsal];
    if (!color) return null;
    const size = this.normalizeSize(`${item.size ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    if (!size) return null;
    return {
      kind: 'BAÑADOR',
      color,
      size,
      subproductName: `Bañador ${this.colorSingularLabel(color)} - ${size}`
    };
  }

  private mapOrderItemToBlankGarment(item: { productType?: string | null; title: string; sku: string; color?: string | null; size?: string | null; variantTitle?: string | null }, mappingIndex?: Map<string, string>) {
    const banador = this.mapBanadorByDorsal(item);
    if (banador) return banador;

    const mappedSubproduct = mappingIndex?.get(`name:${this.normalizeText(item.title)}`) ?? (this.isReliableSku(item.sku) ? mappingIndex?.get(`sku:${item.sku}`) : undefined);
    if (mappedSubproduct) {
      const mapped = this.mapSubproductName(mappedSubproduct);
      if (mapped) {
        // Mapping defines kind+color; size must come from the actual order item variant
        const actualSize = this.normalizeSize(`${item.size ?? ''} ${item.variantTitle ?? ''}`) ?? mapped.size;
        const actualKind = this.inferGarmentKind(`${item.productType ?? ''} ${item.title} ${item.variantTitle ?? ''}`) ?? mapped.kind;
        return {
          ...mapped,
          kind: actualKind,
          size: actualSize,
          subproductName: `${this.kindLabel(actualKind)} ${this.colorSingularLabel(mapped.color)} - ${actualSize}`
        };
      }
    }

    const direct = this.mapDirectProductAttributes(item);
    if (direct) return direct;

    const kind = this.inferGarmentKind(`${item.title} ${item.sku} ${item.variantTitle ?? ''}`)
      ?? this.inferGarmentKind(item.productType ?? '');
    const color = this.normalizeColor(`${item.color ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    const size = this.normalizeSize(`${item.size ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    if (!kind || !color || !size) return null;
    return {
      kind,
      color,
      size,
      subproductName: `${this.kindLabel(kind)} ${this.colorSingularLabel(color)} - ${size}`
    };
  }

  private mapDirectProductAttributes(item: { productType?: string | null; title: string; color?: string | null; size?: string | null; variantTitle?: string | null }) {
    const kind = this.inferGarmentKind(`${item.title} ${item.variantTitle ?? ''}`)
      ?? this.inferGarmentKind(item.productType ?? '');
    const color = this.normalizeColor(`${item.color ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    const size = this.normalizeSize(`${item.size ?? ''} ${item.variantTitle ?? ''} ${item.title}`);
    if (!kind || !color || !size) return null;
    return {
      kind,
      color,
      size,
      subproductName: `${this.kindLabel(kind)} ${this.colorSingularLabel(color)} - ${size}`
    };
  }

  private mapSubproductName(subproductName: string) {
    const kind = this.inferGarmentKind(subproductName);
    const color = this.normalizeColor(subproductName);
    const size = this.normalizeSize(subproductName);
    if (!kind || !color || !size) return null;
    return { kind, color, size, subproductName };
  }

  private mapOrderItemToDtfDesign(
    item: { title: string; sku: string; imageRef?: string | null },
    mapped: { kind: string; color: string; size: string }
  ) {
    if (!this.requiresExternalDtf(mapped, item.title)) return null;
    const label = this.cleanDtfDesignLabel(item.title);
    const slug = this.slugifyDtf(label || item.sku || item.title);
    if (!slug) return null;
    return { label: label || slug, slug, imageRef: item.imageRef?.trim() || null };
  }

  private requiresExternalDtf(mapped: { kind: string; color: string }, title?: string) {
    if (this.normalizeText(title ?? '').includes('quattro')) return true;
    const whiteColors = new Set(['BLANCA', 'BLANCO', 'WHITE']);
    if (mapped.kind === 'BAÑADOR') return true;
    if (mapped.kind !== 'CAMISETA' && mapped.kind !== 'SUDADERA') return false;
    return !whiteColors.has(mapped.color);
  }

  private firstImageRef(item: { imageUrl?: string | null; imageUrlsJson?: unknown }) {
    if (item.imageUrl?.trim()) return item.imageUrl.trim();
    if (Array.isArray(item.imageUrlsJson)) {
      const first = item.imageUrlsJson.find((value) => typeof value === 'string' && value.trim());
      return typeof first === 'string' ? first.trim() : null;
    }
    return null;
  }

  private addDtfCatalogFromMappings(
    dtfDemand: Map<string, MatrixDemand>,
    mappings: Array<{ productName: string; subproductName: string; sku: string; imageRef?: string | null }>
  ) {
    for (const mapping of mappings) {
      const mapped = this.mapSubproductName(mapping.subproductName);
      if (!mapped) continue;
      const dtfDesign = this.mapOrderItemToDtfDesign(
        { title: mapping.productName, sku: mapping.sku, imageRef: 'imageRef' in mapping ? mapping.imageRef : null },
        mapped
      );
      if (!dtfDesign) continue;
      const key = this.dtfKey(dtfDesign.slug);
      if (dtfDemand.has(key)) continue;
      dtfDemand.set(key, {
        kind: 'DTF',
        color: 'EXTERNO',
        size: dtfDesign.slug,
        quantity: 0,
        orders: [],
        label: dtfDesign.label,
        imageRef: dtfDesign.imageRef
      });
    }
  }

  private cleanDtfDesignLabel(title: string) {
    let cleaned = title
      .replace(/[“”]/g, '"')
      .replace(/^(camiseta|t-?shirt|sudadera(?:\s+con\s+capucha)?|hoodie|bañador|banador|swimsuit)\s*/i, '')
      .trim();
    const colors = '(blanco|blanca|negro|negra|black|white|navy|azul|blue|royal\\s*blue|charcoal|sand|arena|mastic|marron|marrón|brown|dark\\s*chocolate|rosa|azalea|tangerine|orange)';
    const sizes = '(xs|xxl|2xl|xl|l|m|s)';
    for (let index = 0; index < 4; index += 1) {
      cleaned = cleaned
        .replace(new RegExp(`\\s*[-/,|]\\s*${sizes}\\s*$`, 'i'), '')
        .replace(new RegExp(`\\s*[-/,|]\\s*${colors}\\s*$`, 'i'), '')
        .trim();
    }
    cleaned = cleaned.replace(/^["'#\s-]+|["'\s-]+$/g, '').trim();
    return cleaned || title.trim();
  }

  private slugifyDtf(value: string) {
    return this.normalizeText(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .toUpperCase();
  }

  private dtfKey(slug: string) {
    return `DTF:${slug}`;
  }

  private async ensureDtfStockItems(dtfDemand: Map<string, MatrixDemand>, existingTransfers: StockItemWithLevels[]) {
    const existingBySku = new Map(existingTransfers.map((item) => [item.sku, item]));
    const existingByCleanSlug = new Set(
      existingTransfers
        .map((item) => this.cleanDtfStockLabel(item))
        .filter((label): label is string => Boolean(label))
        .map((label) => this.slugifyDtf(label))
        .filter(Boolean)
    );
    const missing = [...dtfDemand.values()]
      .map((need) => ({ sku: this.dtfSku(need.size), name: `DTF ${need.label ?? need.size}` }))
      .filter((item) => !existingBySku.has(item.sku) && !existingByCleanSlug.has(item.sku.replace(/^DTF-/, '')));

    if (missing.length && typeof this.prisma.stockItem.upsert === 'function') {
      for (const item of missing) {
        await this.prisma.stockItem.upsert({
          where: { sku: item.sku },
          update: { name: item.name, type: 'TRANSFER', supplierSku: item.sku },
          create: {
            sku: item.sku,
            name: item.name,
            type: 'TRANSFER',
            supplierSku: item.sku,
            minStock: 0
          }
        });
      }
    }

    const stockItems = await this.prisma.stockItem.findMany({
      where: { type: 'TRANSFER', sku: { startsWith: 'DTF-' } },
      include: { levels: true }
    });
    return new Map(stockItems.map((item) => [item.sku, item]));
  }

  private dtfSku(slug: string) {
    return `DTF-${slug}`;
  }

  private buildDtfGroup(
    dtfDemand: Map<string, MatrixDemand>,
    transferIndex: Map<string, StockItemWithLevels>,
    orderedQuantities: Map<string, number>,
    supplierStocks: Array<{ supplierSku: string; availableQuantity: number }>
  ): PurchaseMatrixGroup {
    const group: PurchaseMatrixGroup = {
      key: 'DTF:EXTERNO:',
      garmentType: 'DTF',
      color: 'EXTERNO',
      title: 'DTF EXTERNO',
      theme: { background: '#7C3AED', foreground: '#FFFFFF' },
      sizes: []
    };

    const normalizedTransferIndex = this.buildNormalizedDtfTransferIndex(transferIndex);
    const allSlugs = new Set([
      ...[...dtfDemand.values()].map((need) => need.size),
      ...normalizedTransferIndex.keys()
    ]);

    for (const slug of allSlugs) {
      const need = dtfDemand.get(this.dtfKey(slug));
      const sku = this.dtfSku(slug);
      const stockItem = this.pickDtfStockItem(transferIndex.get(sku), normalizedTransferIndex.get(slug));
      const currentInternalStock = this.stockQuantity(stockItem);
      const minStockTarget = stockItem?.minStock ?? 0;
      const pendingOrderNeed = need?.quantity ?? 0;
      const label = need?.label ?? this.cleanDtfStockLabel(stockItem) ?? slug;
      const imageRef = need?.imageRef ?? null;
      const alreadyOrderedQuantity = stockItem ? orderedQuantities.get(stockItem.id) ?? 0 : 0;
      const recommendedPurchaseQuantity = this.calculateRecommendedPurchaseQuantity({
        pendingOrderNeed,
        minStockTarget,
        currentInternalStock,
        alreadyOrderedQuantity
      });
      group.sizes.push({
        size: slug,
        subproductName: `DTF ${label}`,
        sku: stockItem?.sku ?? sku,
        supplierSku: stockItem?.supplierSku ?? sku,
        stockItemId: stockItem?.id ?? null,
        pendingOrderNeed,
        demandOrders: need?.orders ?? [],
        currentInternalStock,
        minStockTarget,
        alreadyOrderedQuantity,
        recommendedPurchaseQuantity,
        supplierAvailableQuantity: supplierStocks.find((stock) => stock.supplierSku === sku)?.availableQuantity ?? null,
        imageRef
      });
    }

    return group;
  }

  private buildNormalizedDtfTransferIndex(transferIndex: Map<string, StockItemWithLevels>) {
    const normalized = new Map<string, StockItemWithLevels>();
    for (const [sku, stockItem] of transferIndex) {
      if (!sku.startsWith('DTF-')) continue;
      const label = this.cleanDtfStockLabel(stockItem) ?? sku.replace(/^DTF-/, '');
      const slug = this.slugifyDtf(label);
      if (slug && !normalized.has(slug)) normalized.set(slug, stockItem);
    }
    return normalized;
  }

  private cleanDtfStockLabel(stockItem?: StockItemWithLevels | null) {
    if (!stockItem?.name) return null;
    return this.cleanDtfDesignLabel(stockItem.name.replace(/^DTF\s+/i, ''));
  }

  private pickDtfStockItem(exact?: StockItemWithLevels, normalized?: StockItemWithLevels) {
    if (!exact) return normalized ?? null;
    if (!normalized || exact.id === normalized.id) return exact;
    return this.stockQuantity(normalized) > this.stockQuantity(exact) ? normalized : exact;
  }

  private stockQuantity(stockItem?: StockItemWithLevels | null) {
    return stockItem?.levels.reduce((sum, level) => sum + level.quantity, 0) ?? 0;
  }

  private matrixKey(kind: string, color: string, size: string) {
    return `${kind}:${color}:${size}`;
  }

  private async pendingSupplierOrderQuantityByStockItemId() {
    if (!this.prisma.supplierPurchaseOrder?.findMany) return new Map<string, number>();
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

  private kindLabel(kind: string) {
    switch (kind) {
      case 'SUDADERA': return 'Sudadera';
      case 'BAÑADOR': return 'Bañador';
      default: return 'Camiseta';
    }
  }

  private inferGarmentKind(value: string) {
    const normalized = this.normalizeText(value);
    // Word keywords
    if (/\b(banador|swimsuit|swim|bikini)\b/.test(normalized)) return 'BAÑADOR';
    if (/\b(sudadera|hoodie|sweatshirt|hooded)\b/.test(normalized)) return 'SUDADERA';
    if (/\b(camiseta|tshirt|t-shirt|tee|shirt)\b/.test(normalized)) return 'CAMISETA';
    // SKU prefixes: WG* = sudadera, TG* = camiseta, HD* = sudadera, TS* = camiseta
    if (/(?:^|\s|[-/])wg\d/i.test(value)) return 'SUDADERA';
    if (/(?:^|\s|[-/])hd\d/i.test(value)) return 'SUDADERA';
    if (/(?:^|\s|[-/])tg\d/i.test(value)) return 'CAMISETA';
    if (/(?:^|\s|[-/])ts\d/i.test(value)) return 'CAMISETA';
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
      ['CHARCOAL', /\b(charcoal|carbon|gris)\b/],
      ['VERDE', /\b(verde|green)\b/],
      ['ROJO', /\b(rojo|red)\b/],
      ['NARANJA', /\b(naranja|orange)\b/],
      ['TANGERINE', /\b(tangerine)\b/],
      ['NAVY', /\b(navy|marino)\b/],
      ['AZUL', /\b(azul|blue)\b/],
      ['MARRON', /\b(marron|brown)\b/],
      ['ROSA', /\b(rosa|pink)\b/]
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
      NAVY: 'Navy',
      VERDE: 'Verde',
      ROJO: 'Rojo',
      NARANJA: 'Naranja'
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
      NAVY: { background: '#0B416A', foreground: '#FFFFFF' },
      VERDE: { background: '#2E9E5B', foreground: '#FFFFFF' },
      ROJO: { background: '#D7263D', foreground: '#FFFFFF' },
      NARANJA: { background: '#FF7A1A', foreground: '#111111' }
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
  label?: string;
  imageRef?: string | null;
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
    imageRef?: string | null;
  }>;
}
