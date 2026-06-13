import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperationalStatus } from '@prisma/client';
import { BankService } from '../bank/bank.service';
import { MetaService } from '../meta/meta.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseService } from '../purchasing/purchase.service';
import { ShopifyAdapter, ShopifyBalanceTransaction } from '../shopify/shopify.adapter';

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
  wasteCost: number;
  shippingCost: number;
  taxReserve: number;
  cashFree: number;
  netMargin: number;
  netMarginPct: number | null;
  items: OrderItemBreakdown[];
  shipmentCostKnown: boolean;
  shippingCostSource: 'SENDCLOUD' | 'INVOICE_ESTIMATE';
  hasItemPrices: boolean;
}

interface GrowthAction {
  type: string;
  title: string;
  priority: 'REQUIRED' | 'HIGH' | 'MEDIUM' | 'LOW';
  icon: string;
}

@Injectable()
export class EconomicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly shopify: ShopifyAdapter,
    private readonly meta: MetaService,
    private readonly bank: BankService,
    private readonly purchases: PurchaseService
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

  async range(from?: string, to?: string) {
    const start = from ? new Date(`${from}T00:00:00.000`) : new Date();
    const end = to ? new Date(`${to}T23:59:59.999`) : new Date(start);
    if (!to) end.setHours(23, 59, 59, 999);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Rango de fechas invalido');
    }
    return this.summary(start, end);
  }

  /** Plain-language verdict: are the ads working vs today's sales/margin? */
  async adsHealth(from?: string, to?: string) {
    const now = new Date();
    const start = from ? new Date(`${from}T00:00:00.000`) : (() => { const d = new Date(now); d.setHours(0,0,0,0); return d; })();
    const end = to ? new Date(`${to}T23:59:59.999`) : (() => { const d = new Date(now); d.setHours(23,59,59,999); return d; })();
    const fStr = start.toISOString().slice(0, 10);
    const tStr = end.toISOString().slice(0, 10);

    const econ = await this.summary(start, end);
    const meta = await this.meta.summary(fStr, tStr);

    const contributionBeforeAds = econ.netMargin + (econ.adSpend ?? 0); // margin without ad cost
    const orderCount = econ.orderCount;
    const breakEvenCpa = orderCount > 0 ? +(contributionBeforeAds / orderCount).toFixed(2) : null;
    const spend = meta.spend ?? 0;
    const roas = meta.roas ?? null;

    // account verdict
    let status: 'GOOD' | 'WATCH' | 'BAD' | 'INFO';
    let headline: string;
    if (spend <= 0) {
      status = 'INFO';
      headline = 'Sin gasto en ads en este rango.';
    } else if (econ.netMargin < 0) {
      status = 'BAD';
      headline = `Vas MAL: tras pagar ${this.money(spend)} de ads, pierdes ${this.money(Math.abs(econ.netMargin))}.`;
    } else if (breakEvenCpa != null && roas != null && roas < 1.2) {
      status = 'WATCH';
      headline = `Justo: ROAS ${roas.toFixed(2)}x. Cubres pero con poco margen.`;
    } else {
      status = 'GOOD';
      headline = `Vas BIEN: tras los ads te quedan ${this.money(econ.netMargin)}${roas != null ? `. ROAS ${roas.toFixed(2)}x` : ''}.`;
    }

    const campaigns = (meta.campaigns ?? [])
      .filter((c: any) => c.status === 'ACTIVE' || c.spend > 0)
      .map((c: any) => {
        const cpa = c.purchases > 0 ? +(c.spend / c.purchases).toFixed(2) : null;
        let cStatus: 'GOOD' | 'WATCH' | 'BAD';
        let msg: string;
        if (cpa == null) {
          cStatus = c.spend >= 10 ? 'BAD' : 'WATCH';
          msg = `${this.money(c.spend)} gastados, 0 ventas atribuidas.`;
        } else if (breakEvenCpa != null && cpa > breakEvenCpa) {
          cStatus = 'BAD';
          msg = `${this.money(cpa)}/venta > tu margen ${this.money(breakEvenCpa)}/pedido. Pierde ~${this.money(cpa - breakEvenCpa)}/venta.`;
        } else if (breakEvenCpa != null) {
          cStatus = 'GOOD';
          msg = `${this.money(cpa)}/venta < tu margen ${this.money(breakEvenCpa)}/pedido. Rentable.`;
        } else {
          cStatus = 'WATCH';
          msg = `${this.money(cpa)}/venta. Sin datos de margen para comparar.`;
        }
        return { id: c.id, name: c.name, spend: c.spend, purchases: c.purchases, roas: c.roas ?? null, cpa, status: cStatus, message: msg };
      })
      .sort((a, b) => (a.status === 'BAD' ? -1 : 1) - (b.status === 'BAD' ? -1 : 1));

    return {
      from: fStr,
      to: tStr,
      currency: econ.currency,
      status,
      headline,
      spend: +spend.toFixed(2),
      attributedRevenue: meta.attributedRevenue ?? 0,
      roas,
      orders: orderCount,
      salesRevenue: +econ.grossRevenue.toFixed(2),
      netMarginAfterAds: +econ.netMargin.toFixed(2),
      marginPerOrder: breakEvenCpa,
      breakEvenCpa,
      campaigns
    };
  }

  async growthControl() {
    const today = new Date();
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setHours(23, 59, 59, 999);
    const todayKey = today.toISOString().slice(0, 10);

    const [bankAccounts, economics, purchaseMatrix, pendingOrders, metaSummary] = await Promise.all([
      this.bank.accounts().catch(() => ({ currency: 'EUR', totalBalance: 0, balanceAvailable: false, accounts: [] as any[] })),
      this.summary(start, end),
      this.purchases.getPurchaseMatrix().catch(() => ({ groups: [] as any[] })),
      this.pendingWorkshopOrders(),
      this.meta.summary(todayKey, todayKey).catch(() => null)
    ]);

    const currency = bankAccounts.currency ?? economics.currency ?? 'EUR';
    const balanceAvailable = Boolean((bankAccounts as any).balanceAvailable);
    const bankBalance = Number(bankAccounts.totalBalance ?? 0);
    const safetyBuffer = this.cashSafetyBuffer();
    const freeCash = balanceAvailable ? Math.max(0, bankBalance - safetyBuffer) : 0;
    const purchase = this.purchaseExposure(purchaseMatrix);
    const mandatorySpend = purchase.estimatedCost;
    const freeAfterMandatory = Math.max(0, freeCash - mandatorySpend);
    const metaSpend = Number((metaSummary as any)?.spend ?? economics.adSpend ?? 0);
    const metaRoas = (metaSummary as any)?.roas ?? null;
    const pendingRevenue = await this.pendingRevenueEstimate();
    const capacityRisk = pendingOrders.total >= this.maxPendingOrdersBeforeScaling();

    let status: 'SCALE' | 'HOLD' | 'PROTECT' = 'SCALE';
    const actions: GrowthAction[] = [];
    const risks: string[] = [];

    if (!balanceAvailable) {
      status = 'PROTECT';
      risks.push('No hay saldo bancario fiable ahora mismo. Sin saldo real, no escalar.');
      actions.push(this.growthAction('PROTECT_CASH', 'Sincroniza N26 antes de decidir gastos', 'REQUIRED', 'building.columns.fill'));
    }

    if (balanceAvailable && bankBalance < safetyBuffer) {
      status = 'PROTECT';
      risks.push(`La caja esta por debajo del colchon de ${this.formatMoney(safetyBuffer, currency)}.`);
      actions.push(this.growthAction('PROTECT_CASH', 'No gastar salvo pedidos bloqueados', 'REQUIRED', 'shield.fill'));
    } else if (balanceAvailable && freeAfterMandatory < Math.max(100, freeCash * 0.25)) {
      status = status === 'PROTECT' ? status : 'HOLD';
      risks.push('Despues de comprar lo obligatorio queda poca caja libre.');
    }

    if (purchase.units > 0) {
      actions.push(this.growthAction(
        'BUY_MANDATORY_STOCK',
        `Comprar ropa obligatoria: ${purchase.units} uds aprox. (${this.formatMoney(purchase.estimatedCost, currency)})`,
        'HIGH',
        'cart.badge.plus'
      ));
    }

    if (capacityRisk) {
      status = status === 'PROTECT' ? status : 'HOLD';
      risks.push(`Hay ${pendingOrders.total} pedidos pendientes. Escalar ads puede saturar taller.`);
      actions.push(this.growthAction('CLEAR_WORKSHOP', 'Prioriza terminar pedidos antes de subir anuncios', 'HIGH', 'shippingbox.fill'));
    }

    const adsBudget = this.recommendedAdsBudget({ freeAfterMandatory, metaRoas, status, capacityRisk });
    if (adsBudget > 0) {
      actions.push(this.growthAction('SCALE_ADS', `Puedes subir Meta hasta ${this.formatMoney(adsBudget, currency)} hoy`, 'MEDIUM', 'chart.line.uptrend.xyaxis'));
    } else if (metaSpend > 0 && status !== 'SCALE') {
      actions.push(this.growthAction('HOLD_ADS', 'Mantener o bajar Ads hasta proteger caja/taller', 'MEDIUM', 'pause.circle.fill'));
    }

    const headline = this.growthHeadline(status, balanceAvailable, freeAfterMandatory, currency);
    const recommendation = this.growthRecommendation(status, adsBudget, purchase.units, currency);

    return {
      date: todayKey,
      currency,
      status,
      headline,
      recommendation,
      bank: {
        balanceAvailable,
        balance: bankBalance,
        safetyBuffer,
        freeCash
      },
      today: {
        revenue: economics.grossRevenue,
        marginAfterAds: economics.netMargin,
        orders: economics.orderCount,
        adSpend: metaSpend,
        roas: metaRoas
      },
      pending: {
        orders: pendingOrders.total,
        blocked: pendingOrders.blocked,
        estimatedRevenue: pendingRevenue
      },
      purchases: {
        units: purchase.units,
        estimatedCost: purchase.estimatedCost,
        topItems: purchase.topItems
      },
      scale: {
        freeAfterMandatory,
        recommendedAdsBudget: adsBudget,
        capacityRisk
      },
      risks,
      actions
    };
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

  private async pendingWorkshopOrders() {
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
    const [total, blocked] = await Promise.all([
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses } } }),
      this.prisma.order.count({ where: { operationalStatus: OperationalStatus.BLOCKED } })
    ]);
    return { total, blocked };
  }

  private async pendingRevenueEstimate() {
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
    const orders = await this.prisma.order.findMany({
      where: { operationalStatus: { in: pendingStatuses } },
      include: { items: true, shipments: true }
    });
    return +orders.reduce((sum, order) => sum + this.computeOrderBreakdown(order).grossRevenue, 0).toFixed(2);
  }

  private purchaseExposure(matrix: any) {
    const entries = (matrix.groups ?? [])
      .flatMap((group: any) => (group.sizes ?? []).map((entry: any) => ({ group, entry })))
      .filter(({ entry }: any) => Number(entry.recommendedPurchaseQuantity ?? 0) > 0);
    const items = entries.map(({ group, entry }: any) => {
      const quantity = Number(entry.recommendedPurchaseQuantity ?? 0);
      const unitCost = this.estimatedBlankCost(group.garmentType, group.color, entry.subproductName);
      return {
        title: entry.subproductName ?? group.title,
        quantity,
        estimatedCost: +(quantity * unitCost).toFixed(2)
      };
    });
    return {
      units: items.reduce((sum: number, item: any) => sum + item.quantity, 0),
      estimatedCost: +items.reduce((sum: number, item: any) => sum + item.estimatedCost, 0).toFixed(2),
      topItems: items.sort((a: any, b: any) => b.estimatedCost - a.estimatedCost).slice(0, 5)
    };
  }

  private estimatedBlankCost(garmentType?: string, color?: string, name?: string) {
    const text = this.normalize(`${garmentType ?? ''} ${color ?? ''} ${name ?? ''}`);
    if (/sudadera/.test(text)) return this.moneyConfig('GROWTH_SWEATSHIRT_UNIT_COST', 8.05);
    if (/camiseta|shirt/.test(text)) return this.moneyConfig(/marron|rosa|azalea|chocolate/.test(text) ? 'GROWTH_GILDAN_TSHIRT_UNIT_COST' : 'GROWTH_TSHIRT_UNIT_COST', /marron|rosa|azalea|chocolate/.test(text) ? 2.84 : 3.19);
    return this.moneyConfig('GROWTH_OTHER_PURCHASE_UNIT_COST', 0);
  }

  private recommendedAdsBudget(input: { freeAfterMandatory: number; metaRoas: number | null; status: 'SCALE' | 'HOLD' | 'PROTECT'; capacityRisk: boolean }) {
    if (input.status === 'PROTECT' || input.capacityRisk || input.freeAfterMandatory < 150) return 0;
    const base = Math.min(input.freeAfterMandatory * 0.2, this.moneyConfig('GROWTH_MAX_DAILY_ADS_SCALE_EUR', 50));
    if (input.metaRoas != null && input.metaRoas < 1.4) return 0;
    if (input.metaRoas != null && input.metaRoas > 2.2) return +Math.max(10, base).toFixed(2);
    return +Math.min(base, 20).toFixed(2);
  }

  private growthHeadline(status: 'SCALE' | 'HOLD' | 'PROTECT', balanceAvailable: boolean, freeAfterMandatory: number, currency: string) {
    if (!balanceAvailable) return 'Sin saldo fiable: primero sincroniza N26.';
    if (status === 'PROTECT') return 'Proteger caja: hoy no toca escalar.';
    if (status === 'HOLD') return 'Aguantar: vender si, pero sin acelerar fuerte.';
    return `Puedes escalar con cabeza: quedan ${this.formatMoney(freeAfterMandatory, currency)} libres tras compras obligatorias.`;
  }

  private growthRecommendation(status: 'SCALE' | 'HOLD' | 'PROTECT', adsBudget: number, purchaseUnits: number, currency: string) {
    if (status === 'PROTECT') return 'Prioriza caja y pedidos bloqueados. No metas gasto opcional.';
    if (status === 'HOLD') return purchaseUnits > 0 ? 'Compra lo necesario para producir, termina pedidos y reevalua mañana.' : 'Mantén ads, no subas presupuesto hasta ver mas caja o menos cola.';
    if (adsBudget > 0) return `Compra lo obligatorio y puedes probar una subida de Ads de hasta ${this.formatMoney(adsBudget, currency)}.`;
    return 'Caja sana, pero sin señal clara para subir Ads. Mantener y observar.';
  }

  private growthAction(type: string, title: string, priority: GrowthAction['priority'], icon: string): GrowthAction {
    return { type, title, priority, icon };
  }

  private cashSafetyBuffer(): number {
    const raw = this.config.get<string>('CASH_SAFETY_BUFFER_EUR');
    const parsed = Number(raw?.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 500;
  }

  private maxPendingOrdersBeforeScaling(): number {
    const raw = this.config.get<string>('GROWTH_MAX_PENDING_ORDERS_BEFORE_HOLD');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 35;
  }

  private formatMoney(value: number, currency: string) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  }

  async orderBreakdown(orderId: string): Promise<OrderBreakdown | null> {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: { items: true, shipments: true }
    });
    if (!order) return null;
    return this.computeOrderBreakdown(order);
  }

  async markPayout(payoutId: string) {
    try {
      await this.prisma.payoutMark.upsert({
        where: { payoutId },
        create: { payoutId },
        update: { markedAt: new Date() }
      });
    } catch { /* table may not exist yet */ }
    return { payoutId, marked: true };
  }

  async unmarkPayout(payoutId: string) {
    try {
      await this.prisma.payoutMark.deleteMany({ where: { payoutId } });
    } catch { /* table may not exist yet */ }
    return { payoutId, marked: false };
  }

  async cashflow() {
    const today = new Date().toISOString().slice(0, 10);
    const shopifyFeeRate = 0.024;
    const taxRate = this.taxReserveRate();
    const productionRate = this.productionRate();
    const shippingRate = this.shippingRate();

    const allPayouts = await this.shopify.listPayouts();
    let markedIds = new Set<string>();
    try {
      const marks = await this.prisma.payoutMark.findMany({ select: { payoutId: true } });
      markedIds = new Set(marks.map(m => m.payoutId));
    } catch { /* table may not exist yet */ }

    const paidToday = allPayouts.filter(p => p.status === 'paid' && p.date === today);
    const inTransit = allPayouts.filter(p => p.status === 'in_transit');
    const scheduledSoon = allPayouts.filter(p => p.status === 'scheduled');

    const enrichPayout = async (payout: any) => {
      const amount = this.money(payout.amount);
      const transactions = await this.shopify.listPayoutTransactions(payout.id);
      const charges = transactions.filter(t => t.type === 'charge');
      const refunds = transactions.filter(t => t.type === 'refund');

      // Look up order numbers in DB using source_order_id
      const sourceIds = charges
        .map(t => t.source_order_id ? String(t.source_order_id) : null)
        .filter(Boolean) as string[];
      const dbOrders = sourceIds.length
        ? await this.prisma.order.findMany({
            where: { shopifyOrderId: { in: sourceIds.map(id => `gid://shopify/Order/${id}`) } },
            select: {
              shopifyOrderId: true,
              orderNumber: true,
              orderedAt: true,
              items: { select: { title: true, variantTitle: true, sku: true, quantity: true, unitPrice: true } }
            }
          })
        : [];
      const orderBySourceId = new Map(
        dbOrders.map(o => [o.shopifyOrderId.split('/').pop()!, o])
      );

      const orders = charges.map(t => {
        const sourceId = t.source_order_id ? String(t.source_order_id) : null;
        const dbOrder = sourceId ? orderBySourceId.get(sourceId) : null;
        const orderNumber = dbOrder?.orderNumber
          ?? t.adjustment_order_transactions?.map((a: any) => a.order?.name).find(Boolean)
          ?? null;
        const saleDate = dbOrder?.orderedAt
          ? dbOrder.orderedAt.toISOString().slice(0, 10)
          : t.processed_at?.slice(0, 10) ?? null;
        const retroUnits = this.retroAstonUnits(dbOrder);
        const retroReserve = +(retroUnits * this.retroAstonUnitCost()).toFixed(2);
        return {
          orderNumber,
          saleDate,
          amount: this.money(t.amount),
          fee: -Math.abs(this.money(t.fee)),
          processedAt: t.processed_at?.slice(0, 10),
          retroUnits,
          retroReserve
        };
      });

      // Group by sale date to show "ventas del dia X"
      const byDate = new Map<string, { date: string; orders: typeof orders; subtotal: number }>();
      for (const o of orders) {
        const key = o.saleDate ?? 'unknown';
        const group = byDate.get(key) ?? { date: key, orders: [], subtotal: 0 };
        group.orders.push(o);
        group.subtotal += o.amount;
        byDate.set(key, group);
      }
      const salesDays = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      const adsReserve = await this.adsReserveForSalesDays(salesDays.map(day => day.date));
      const retroPreorder = +orders.reduce((sum, order) => sum + order.retroReserve, 0).toFixed(2);
      const retroUnits = orders.reduce((sum, order) => sum + order.retroUnits, 0);

      const gross = amount / (1 - shopifyFeeRate);
      return {
        id: String(payout.id),
        date: payout.date,
        amount,
        currency: payout.currency,
        marked: markedIds.has(String(payout.id)),
        shopifyFee: +(-(gross * shopifyFeeRate)).toFixed(2),
        refunds: +refunds.reduce((s, t) => s + this.money(t.amount), 0).toFixed(2),
        orders,
        salesDays,
        retroPreorder: {
          units: retroUnits,
          reserve: retroPreorder,
          unitCost: this.retroAstonUnitCost(),
          totalCommitment: this.retroAstonTotalCommitment(),
          sellingPrice: this.retroAstonSellingPrice()
        },
        allocation: {
          taxReserve: +(gross * taxRate).toFixed(2),
          production: +(gross * productionRate).toFixed(2),
          shipping: +(gross * shippingRate).toFixed(2),
          adsReserve,
          retroPreorder,
          cashFree: +(amount - gross * taxRate - gross * productionRate - gross * shippingRate - adsReserve - retroPreorder).toFixed(2)
        }
      };
    };

    const todayPayouts = await Promise.all(paidToday.map(enrichPayout));
    const todayTotal = todayPayouts.reduce((s, p) => s + p.amount, 0);
    const todayAllocation = {
      taxReserve: +todayPayouts.reduce((s, p) => s + p.allocation.taxReserve, 0).toFixed(2),
      production: +todayPayouts.reduce((s, p) => s + p.allocation.production, 0).toFixed(2),
      shipping: +todayPayouts.reduce((s, p) => s + p.allocation.shipping, 0).toFixed(2),
      adsReserve: +todayPayouts.reduce((s, p) => s + p.allocation.adsReserve, 0).toFixed(2),
      retroPreorder: +todayPayouts.reduce((s, p) => s + p.allocation.retroPreorder, 0).toFixed(2),
      cashFree: +todayPayouts.reduce((s, p) => s + p.allocation.cashFree, 0).toFixed(2)
    };

    return {
      today: today,
      currency: allPayouts[0]?.currency ?? 'EUR',
      receivedToday: +todayTotal.toFixed(2),
      payouts: todayPayouts,
      allocation: todayAllocation,
      pending: {
        amount: +inTransit.reduce((s, p) => s + this.money(p.amount), 0).toFixed(2),
        payouts: await Promise.all(inTransit.map(enrichPayout))
      },
      scheduled: {
        amount: +scheduledSoon.reduce((s, p) => s + this.money(p.amount), 0).toFixed(2),
        payouts: await Promise.all(scheduledSoon.map(enrichPayout))
      }
    };
  }

  private async adsReserveForSalesDays(days: string[]) {
    const uniqueDays = [...new Set(days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))];
    const values = await Promise.all(uniqueDays.map((day) => this.meta.spendForRange(day, day).catch(() => 0)));
    return +values.reduce((sum, value) => sum + value, 0).toFixed(2);
  }

  private retroAstonTotalCommitment() {
    return 2194.94;
  }

  private retroAstonSellingPrice() {
    return 54.95;
  }

  private retroAstonUnitCost() {
    return this.retroAstonTotalCommitment() / 100;
  }

  private retroAstonUnits(order?: { items?: Array<{ title: string; variantTitle: string | null; sku: string; quantity: number }> } | null) {
    return order?.items?.reduce((sum, item) => sum + (this.isRetroAstonItem(item) ? item.quantity : 0), 0) ?? 0;
  }

  private isRetroAstonItem(item: { title: string; variantTitle: string | null; sku: string }) {
    const text = this.normalizeSearchText([item.title, item.variantTitle, item.sku].filter(Boolean).join(' '));
    return text.includes('retro') && (text.includes('aston') || text.includes('astn') || text.includes('alonso'));
  }

  private normalizeSearchText(value: string) {
    return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }

  async payouts() {
    const limit = Math.min(Number(this.config.get('ECONOMICS_PAYOUT_LIMIT') ?? 8), 20);
    const payouts = (await this.shopify.listPayouts()).slice(0, limit);
    const enriched = [];

    for (const payout of payouts) {
      const transactions = await this.shopify.listPayoutTransactions(payout.id);
      const orderKeys = this.orderKeysFromTransactions(transactions);
      const orders = orderKeys.length
        ? await this.prisma.order.findMany({
          where: {
            OR: [
              { shopifyOrderId: { in: orderKeys.map((key) => `gid://shopify/Order/${key}`).filter((key) => !key.includes('#')) } },
              { orderNumber: { in: orderKeys.filter((key) => key.startsWith('#')) } }
            ]
          },
          include: { items: true, shipments: true }
        })
        : [];
      const orderByShopifyId = new Map(orders.map((order) => [order.shopifyOrderId.split('/').pop(), this.computeOrderBreakdown(order)]));
      const orderByNumber = new Map(orders.map((order) => [order.orderNumber, this.computeOrderBreakdown(order)]));

      const lines = transactions.map((transaction) => {
        const orderNumber = this.orderNumberFromTransaction(transaction);
        const sourceOrderId = transaction.source_order_id ? String(transaction.source_order_id) : undefined;
        const breakdown = (sourceOrderId ? orderByShopifyId.get(sourceOrderId) : undefined)
          ?? (orderNumber ? orderByNumber.get(orderNumber) : undefined);
        return {
          id: String(transaction.id),
          processedAt: transaction.processed_at,
          orderNumber,
          type: transaction.type,
          amount: this.money(transaction.amount),
          fee: -Math.abs(this.money(transaction.fee)),
          net: this.money(transaction.net),
          currency: transaction.currency,
          sourceOrderId,
          orderId: breakdown?.orderId,
          margin: breakdown?.netMargin ?? null,
          productCost: breakdown?.productCost ?? null,
          wasteCost: breakdown?.wasteCost ?? null,
          shippingCost: breakdown?.shippingCost ?? null
        };
      });

      const charges = lines.filter((line) => line.type === 'charge').reduce((sum, line) => sum + line.amount, 0);
      const refunds = lines.filter((line) => line.type === 'refund').reduce((sum, line) => sum + line.amount, 0);
      const fees = lines.reduce((sum, line) => sum + line.fee, 0);
      const net = lines.reduce((sum, line) => sum + line.net, 0);
      enriched.push({
        id: String(payout.id),
        status: payout.status,
        date: payout.date,
        currency: payout.currency,
        amount: this.money(payout.amount),
        charges,
        refunds,
        fees,
        net,
        estimatedMargin: lines.reduce((sum, line) => sum + (line.margin ?? 0), 0),
        lines
      });
    }

    return {
      currency: enriched[0]?.currency ?? 'EUR',
      payoutCount: enriched.length,
      totalAmount: enriched.reduce((sum, payout) => sum + payout.amount, 0),
      totalCharges: enriched.reduce((sum, payout) => sum + payout.charges, 0),
      totalRefunds: enriched.reduce((sum, payout) => sum + payout.refunds, 0),
      totalFees: enriched.reduce((sum, payout) => sum + payout.fees, 0),
      totalEstimatedMargin: enriched.reduce((sum, payout) => sum + payout.estimatedMargin, 0),
      payouts: enriched
    };
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
        acc.wasteCost += breakdown.wasteCost;
        acc.shippingCost += breakdown.shippingCost;
        acc.taxReserve += breakdown.taxReserve;
        acc.cashFree += breakdown.cashFree;
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
        wasteCost: 0,
        shippingCost: 0,
        taxReserve: 0,
        cashFree: 0,
        netMargin: 0,
        orderCount: 0
      }
    );

    const adSpend = await this.meta.spendForRange(
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10)
    );

    const shippingReserve = breakdowns.reduce((sum, breakdown) => sum + breakdown.shippingCost, 0);
    const replacementReserve = totals.productCost + totals.wasteCost;
    const cashOut = totals.shippingCost + replacementReserve + totals.shopifyFee + totals.taxReserve + adSpend;
    const cashFree = totals.grossRevenue - cashOut;
    const cashFreePct = totals.grossRevenue > 0 ? (cashFree / totals.grossRevenue) * 100 : null;
    const cashStatus = this.cashStatus(cashFree, totals.grossRevenue);

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      currency: breakdowns[0]?.currency ?? 'EUR',
      ...totals,
      netMargin: totals.netMargin - adSpend,
      netMarginPct: totals.grossRevenue > 0 ? ((totals.netMargin - adSpend) / totals.grossRevenue) * 100 : null,
      shippingReserve,
      replacementReserve,
      adSpend,
      taxReserveRate: this.taxReserveRate(),
      cashOut,
      cashFree,
      cashFreePct,
      cashStatus,
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
    const wasteCost = productCost * this.wasteRate();
    const shipmentWithCost = order.shipments.find((shipment: any) => typeof shipment.cost === 'number');
    const shipmentCostKnown = Boolean(shipmentWithCost);
    const shippingCost = shipmentCostKnown ? shipmentWithCost.cost : this.estimatedShippingCost(order);
    const shopifyFee = grossRevenue * SHOPIFY_FEE_RATE;
    const taxReserve = grossRevenue * this.taxReserveRate();
    const cashFree = grossRevenue - productCost - wasteCost - shippingCost - shopifyFee - taxReserve;
    const netMargin = grossRevenue - productCost - wasteCost - shippingCost - shopifyFee;
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
      wasteCost,
      shippingCost,
      taxReserve,
      cashFree,
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

  private wasteRate(): number {
    const raw = this.config.get<string>('ECONOMICS_WASTE_RATE');
    if (!raw) return 0.02;
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.02;
  }

  private productionRate(): number {
    const raw = this.config.get<string>('ALLOCATION_PRODUCTION_RATE');
    const parsed = Number(raw?.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.22;
  }

  private shippingRate(): number {
    const raw = this.config.get<string>('ALLOCATION_SHIPPING_RATE');
    const parsed = Number(raw?.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.10;
  }

  private taxReserveRate(): number {
    const raw = this.config.get<string>('ECONOMICS_TAX_RESERVE_RATE');
    if (!raw) return 0.15;
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.15;
  }

  private cashStatus(cashFree: number, grossRevenue: number): 'HEALTHY' | 'WATCH' | 'HOLD' {
    if (grossRevenue <= 0 || cashFree <= 0) return 'HOLD';
    const pct = cashFree / grossRevenue;
    if (pct < 0.12) return 'HOLD';
    if (pct < 0.22) return 'WATCH';
    return 'HEALTHY';
  }

  private orderKeysFromTransactions(transactions: ShopifyBalanceTransaction[]) {
    const keys = transactions.flatMap((transaction) => {
      const keys: string[] = [];
      if (transaction.source_order_id) keys.push(String(transaction.source_order_id));
      const orderName = this.orderNumberFromTransaction(transaction);
      if (orderName) keys.push(orderName);
      return keys;
    });
    return [...new Set(keys)];
  }

  private orderNumberFromTransaction(transaction: ShopifyBalanceTransaction) {
    return transaction.adjustment_order_transactions
      ?.map((adjustment) => adjustment.order?.name)
      .find((name): name is string => Boolean(name));
  }

  private money(value?: string | number | null): number {
    if (value == null) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
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
    const isBanador = /bañad|banad|swim|bikini|bath/.test(type);
    const isSudadera = /sudader/.test(type);
    const isCamiseta = !isBanador && (/camiset/.test(type) || !isSudadera);
    const isBlack = /negro|black/.test(color);
    const isWhite = /blanco|white/.test(color);

    let blank = 0;
    let print = 0;
    let description = '';
    if (isBanador) {
      blank = 4.725; // 4,725 € + IVA (neto, IVA recuperable)
      print = 2.25 + 0.45; // siempre DTF
      description = 'Bañador (DTF espalda+frontal)';
    } else if (isSudadera) {
      blank = 6.60;
      if (isBlack) {
        print = 2.25 + 0.45;
        description = 'Sudadera negra (DTF espalda+frontal)';
      } else {
        print = 0.50;
        description = 'Sudadera blanca (DTG)';
      }
    } else if (isCamiseta) {
      blank = 2.73;
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
