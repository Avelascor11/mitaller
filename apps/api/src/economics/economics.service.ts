import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const SHOPIFY_FEE_RATE = 0.024; // 2.4 % comisión Shopify Payments

interface ItemCost {
  blank: number;
  print: number;
  description: string;
}

interface OrderItemBreakdown {
  itemId: string;
  sku: string;
  title: string;
  variantTitle?: string | null;
  color?: string | null;
  size?: string | null;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  costDescription: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
}

interface OrderBreakdown {
  orderId: string;
  orderNumber: string;
  customer: string;
  orderedAt: Date;
  currency: string;
  itemsRevenue: number;
  shippingRevenue: number;
  totalDiscount: number;
  grossRevenue: number;
  shopifyFee: number;
  productCost: number;
  shippingCost: number;
  netMargin: number;
  netMarginPct: number | null;
  items: OrderItemBreakdown[];
  shipmentCostKnown: boolean;
  shippingCostSource: 'SENDCLOUD' | 'INVOICE_ESTIMATE';
  hasItemPrices: boolean;
}

@Injectable()
export class EconomicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async today() {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return this.summary(start, end);
  }

  async month(year?: number, month?: number) {
    const now = new Date();
    const y = year ?? now.getFullYear();
    const m = (month ?? now.getMonth() + 1) - 1;
    const start = new Date(y, m, 1, 0, 0, 0, 0);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return this.summary(start, end);
  }

  async productMargins() {
    const orders = await this.prisma.order.findMany({
      where: { items: { some: {} } },
      include: { items: true, shipments: true }
    });
    const map = new Map<string, { sku: string; title: string; quantity: number; revenue: number; cost: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const cost = this.itemCost(item);
        const rev = (item.unitPrice ?? 0) * item.quantity;
        const totalCost = (cost.blank + cost.print) * item.quantity;
        const key = `${item.sku || item.title}`;
        const acc = map.get(key) ?? { sku: item.sku, title: item.title, quantity: 0, revenue: 0, cost: 0 };
        acc.quantity += item.quantity;
        acc.revenue += rev;
        acc.cost += totalCost;
        map.set(key, acc);
      }
    }
    return [...map.values()]
      .map((row) => ({
        ...row,
        margin: row.revenue - row.cost,
        marginPct: row.revenue > 0 ? ((row.revenue - row.cost) / row.revenue) * 100 : null
      }))
      .sort((a, b) => b.margin - a.margin);
  }

  async orderBreakdown(orderId: string): Promise<OrderBreakdown | null> {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: { items: true, shipments: true }
    });
    if (!order) return null;
    return this.computeOrderBreakdown(order);
  }

  private async summary(start: Date, end: Date) {
    const orders = await this.prisma.order.findMany({
      where: { orderedAt: { gte: start, lte: end } },
      include: { items: true, shipments: true },
      orderBy: { orderedAt: 'asc' }
    });

    const breakdowns = orders.map((order) => this.computeOrderBreakdown(order));
    const totals = breakdowns.reduce(
      (acc, breakdown) => {
        acc.grossRevenue += breakdown.grossRevenue;
        acc.itemsRevenue += breakdown.itemsRevenue;
        acc.shippingRevenue += breakdown.shippingRevenue;
        acc.totalDiscount += breakdown.totalDiscount;
        acc.shopifyFee += breakdown.shopifyFee;
        acc.productCost += breakdown.productCost;
        acc.shippingCost += breakdown.shippingCost;
        acc.netMargin += breakdown.netMargin;
        acc.orderCount += 1;
        return acc;
      },
      {
        grossRevenue: 0,
        itemsRevenue: 0,
        shippingRevenue: 0,
        totalDiscount: 0,
        shopifyFee: 0,
        productCost: 0,
        shippingCost: 0,
        netMargin: 0,
        orderCount: 0
      }
    );

    const shippingReserve = breakdowns.reduce((sum, breakdown) => sum + breakdown.shippingCost, 0);

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      currency: breakdowns[0]?.currency ?? 'EUR',
      ...totals,
      netMarginPct: totals.grossRevenue > 0 ? (totals.netMargin / totals.grossRevenue) * 100 : null,
      shippingReserve,
      orders: breakdowns
    };
  }

  private computeOrderBreakdown(order: any): OrderBreakdown {
    const items: OrderItemBreakdown[] = order.items.map((item: any) => {
      const cost = this.itemCost(item);
      const unitCost = cost.blank + cost.print;
      const unitPrice = item.unitPrice ?? 0;
      const revenue = unitPrice * item.quantity;
      const totalCost = unitCost * item.quantity;
      return {
        itemId: item.id,
        sku: item.sku,
        title: item.title,
        variantTitle: item.variantTitle,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        unitPrice,
        unitCost,
        costDescription: cost.description,
        revenue,
        cost: totalCost,
        margin: revenue - totalCost,
        marginPct: revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : null
      };
    });

    const itemsRevenue = order.subtotalPrice ?? items.reduce((sum, item) => sum + item.revenue, 0);
    const shippingRevenue = order.totalShipping ?? 0;
    const totalDiscount = order.totalDiscount ?? 0;
    const grossRevenue = order.totalPrice ?? itemsRevenue + shippingRevenue - totalDiscount;
    const productCost = items.reduce((sum, item) => sum + item.cost, 0);
    const shipmentWithCost = order.shipments.find((shipment: any) => typeof shipment.cost === 'number');
    const shipmentCostKnown = Boolean(shipmentWithCost);
    const shippingCost = shipmentCostKnown ? shipmentWithCost.cost : this.estimatedShippingCost(order);
    const shopifyFee = grossRevenue * SHOPIFY_FEE_RATE;
    const netMargin = grossRevenue - productCost - shippingCost - shopifyFee;
    const hasItemPrices = items.some((item) => item.unitPrice > 0);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customer: order.customerName,
      orderedAt: order.orderedAt,
      currency: order.currency ?? 'EUR',
      itemsRevenue,
      shippingRevenue,
      totalDiscount,
      grossRevenue,
      shopifyFee,
      productCost,
      shippingCost,
      netMargin,
      netMarginPct: grossRevenue > 0 ? (netMargin / grossRevenue) * 100 : null,
      items,
      shipmentCostKnown,
      shippingCostSource: shipmentCostKnown ? 'SENDCLOUD' : 'INVOICE_ESTIMATE',
      hasItemPrices
    };
  }

  private estimatedShippingCost(order: any): number {
    const method = this.normalize(`${order.shippingMethod ?? ''}`);
    const country = this.normalize(`${order.shippingCountry ?? 'ES'}`);
    const itemCount = order.items?.reduce((sum: number, item: any) => sum + (item.quantity ?? 0), 0) ?? 1;

    if (country && country !== 'es' && country !== 'espana' && country !== 'spain') {
      return this.moneyConfig('ECONOMICS_SHIPPING_COST_INTERNATIONAL', 12.45);
    }

    if (/premium|express|24h|urgente/.test(method)) {
      return this.moneyConfig('ECONOMICS_SHIPPING_COST_PREMIUM_ES', 4.26);
    }

    if (/paq ligero|ligero|carta|letter/.test(method)) {
      return this.moneyConfig('ECONOMICS_SHIPPING_COST_LIGHT_ES', 3.31);
    }

    if (/1-2kg|1 a 2kg|1kg-2kg/.test(method) || itemCount >= 4) {
      return this.moneyConfig('ECONOMICS_SHIPPING_COST_STANDARD_ES_1_2KG', 3.98);
    }

    return this.moneyConfig('ECONOMICS_SHIPPING_COST_STANDARD_ES', 3.81);
  }

  private moneyConfig(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private normalize(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private itemCost(item: any): ItemCost {
    const type = (item.productType ?? item.title ?? '').toString().toLowerCase();
    const color = (item.color ?? item.variantTitle ?? '').toString().toLowerCase();
    const isSudadera = /sudader/.test(type);
    const isCamiseta = /camiset/.test(type) || !isSudadera;
    const isBlack = /negro|black/.test(color);
    const isWhite = /blanco|white/.test(color);

    let blank = 0;
    let print = 0;
    let description = '';
    if (isSudadera) {
      blank = 6.79;
      if (isBlack) {
        print = 2.25 + 0.45;
        description = 'Sudadera negra (DTF espalda+frontal)';
      } else {
        print = 0.50;
        description = 'Sudadera blanca (DTG)';
      }
    } else if (isCamiseta) {
      blank = 2.79;
      if (isBlack) {
        print = 2.25 + 0.45;
        description = 'Camiseta negra (DTF espalda+frontal)';
      } else if (isWhite) {
        print = 0.50;
        description = 'Camiseta blanca (DTG)';
      } else {
        print = 0.50;
        description = 'Camiseta (DTG estimado)';
      }
    } else {
      description = 'Producto sin coste configurado';
    }
    return { blank, print, description };
  }
}
