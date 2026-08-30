import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperationalStatus } from '@prisma/client';
import { BankService } from '../bank/bank.service';
import { MetaService } from '../meta/meta.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseService } from '../purchasing/purchase.service';
import { ShopifyAdapter, ShopifyBalanceTransaction } from '../shopify/shopify.adapter';

const SHOPIFY_FEE_RATE = 0.024; // 2.4 % comisión Shopify Payments
const EXTREME_SAVINGS_PLAN_ID = 'speedwear-extreme';
const EXTREME_SAVINGS_SEED_VERSION = 2;

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

    const [bankAccounts, economics, purchaseMatrix, pendingOrders, metaSummary, fixedExpenses] = await Promise.all([
      this.bank.accounts().catch(() => ({ currency: 'EUR', totalBalance: 0, balanceAvailable: false, accounts: [] as any[] })),
      this.summary(start, end),
      this.purchases.getPurchaseMatrix().catch(() => ({ groups: [] as any[] })),
      this.pendingWorkshopOrders(),
      this.meta.summary(todayKey, todayKey).catch(() => null),
      this.fixedExpenses().catch(() => null)
    ]);

    const currency = bankAccounts.currency ?? economics.currency ?? 'EUR';
    const balanceAvailable = Boolean((bankAccounts as any).balanceAvailable);
    const bankBalance = Number(bankAccounts.totalBalance ?? 0);
    const safetyBuffer = this.cashSafetyBuffer();
    const freeCash = balanceAvailable ? Math.max(0, bankBalance - safetyBuffer) : 0;
    const purchase = this.purchaseExposure(purchaseMatrix);
    const fixedPending = Number((fixedExpenses as any)?.pending ?? 0);
    const mandatorySpend = purchase.estimatedCost + fixedPending;
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

    if (fixedPending > 0) {
      actions.push(this.growthAction(
        'FIXED_EXPENSES',
        `Reservar gastos fijos pendientes: ${this.formatMoney(fixedPending, currency)}`,
        'HIGH',
        'building.columns.fill'
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
      fixedExpenses: {
        pending: fixedPending,
        totalMonthly: Number((fixedExpenses as any)?.totalMonthly ?? 0),
        paid: Number((fixedExpenses as any)?.paid ?? 0)
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
    if (/sudadera/.test(text)) return this.moneyConfig('GROWTH_SWEATSHIRT_UNIT_COST', 10.75);
    if (/boxy/.test(text)) return this.moneyConfig('GROWTH_BOXY_TSHIRT_UNIT_COST', 4.9);
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

    const fixedExpenses = await this.fixedExpenses().catch(() => null);
    const todayPayouts = await Promise.all(paidToday.map(enrichPayout));
    const todayTotal = todayPayouts.reduce((s, p) => s + p.amount, 0);
    const cashFreeBeforeOperations = +todayPayouts.reduce((s, p) => s + p.allocation.cashFree, 0).toFixed(2);
    const operationsReserve = +Math.min(Math.max(cashFreeBeforeOperations, 0), Number((fixedExpenses as any)?.pending ?? 0)).toFixed(2);
    const todayAllocation = {
      taxReserve: +todayPayouts.reduce((s, p) => s + p.allocation.taxReserve, 0).toFixed(2),
      production: +todayPayouts.reduce((s, p) => s + p.allocation.production, 0).toFixed(2),
      shipping: +todayPayouts.reduce((s, p) => s + p.allocation.shipping, 0).toFixed(2),
      adsReserve: +todayPayouts.reduce((s, p) => s + p.allocation.adsReserve, 0).toFixed(2),
      retroPreorder: +todayPayouts.reduce((s, p) => s + p.allocation.retroPreorder, 0).toFixed(2),
      operationsReserve,
      cashFree: +(cashFreeBeforeOperations - operationsReserve).toFixed(2)
    };

    return {
      today: today,
      currency: allPayouts[0]?.currency ?? 'EUR',
      receivedToday: +todayTotal.toFixed(2),
      payouts: todayPayouts,
      allocation: todayAllocation,
      fixedExpenses,
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

  async salesCashflow() {
    const currency = 'EUR';
    const scenarios = [
      this.saleScenario({
        id: 'clearance-50',
        title: 'Camisetas al 50%',
        description: 'Prenda lenta a mitad de precio. Útil para liberar stock, no para escalar anuncios.',
        units: 15,
        grossRevenue: 15 * 14.98,
        productCost: 15 * (2.73 + 0.50),
        shippingCost: 5 * this.moneyConfig('ECONOMICS_SHIPPING_COST_STANDARD_ES', 3.81)
      }),
      this.saleScenario({
        id: 'summer-pack',
        title: 'Pack verano 50€',
        description: '2 camisetas + bañador. Mejor AOV, margen correcto si no metemos envío gratis agresivo.',
        units: 3,
        grossRevenue: 3 * 50,
        productCost: 3 * ((2.73 + 0.50) * 2 + (4.725 + 2.70)),
        shippingCost: 3 * this.moneyConfig('ECONOMICS_SHIPPING_COST_STANDARD_ES_1_2KG', 3.98)
      }),
      this.saleScenario({
        id: 'third-tee-5',
        title: '2 camisetas + tercera a 5€',
        description: 'Sube unidades por pedido. Solo merece la pena para mover tallas/parados.',
        units: 3,
        grossRevenue: 3 * (29.95 + 29.95 + 5),
        productCost: 3 * ((2.73 + 0.50) * 3),
        shippingCost: 3 * this.moneyConfig('ECONOMICS_SHIPPING_COST_STANDARD_ES', 3.81)
      })
    ];
    const totals = scenarios.reduce((acc, scenario) => ({
      grossRevenue: acc.grossRevenue + scenario.grossRevenue,
      productCost: acc.productCost + scenario.productCost,
      shippingCost: acc.shippingCost + scenario.shippingCost,
      shopifyFee: acc.shopifyFee + scenario.shopifyFee,
      taxReserve: acc.taxReserve + scenario.taxReserve,
      cashFree: acc.cashFree + scenario.cashFree,
      netMargin: acc.netMargin + scenario.netMargin
    }), { grossRevenue: 0, productCost: 0, shippingCost: 0, shopifyFee: 0, taxReserve: 0, cashFree: 0, netMargin: 0 });

    const fixedExpenses = await this.fixedExpenses().catch(() => null);
    const pendingFixed = Number((fixedExpenses as any)?.pending ?? 0);
    const protectedCashFree = +Math.max(0, totals.cashFree - pendingFixed).toFixed(2);

    return {
      title: 'Rebajas agosto',
      currency,
      assumptions: [
        'Cálculo preventivo: se actualiza con pedidos reales cuando entren desde Shopify.',
        'La caja real ya descuenta rebajas usando totalPrice/totalDiscount de Shopify.',
        'No incluye ads: si activas Meta, réstalo de caja libre.'
      ],
      totals: {
        grossRevenue: this.roundMoney(totals.grossRevenue),
        productCost: this.roundMoney(totals.productCost),
        shippingCost: this.roundMoney(totals.shippingCost),
        shopifyFee: this.roundMoney(totals.shopifyFee),
        taxReserve: this.roundMoney(totals.taxReserve),
        cashFree: this.roundMoney(totals.cashFree),
        netMargin: this.roundMoney(totals.netMargin),
        fixedExpensesPending: this.roundMoney(pendingFixed),
        protectedCashFree,
        cashFreePct: totals.grossRevenue > 0 ? this.roundMoney((totals.cashFree / totals.grossRevenue) * 100) : null
      },
      recommendation: protectedCashFree < 100
        ? 'Rebajas defensivas: limita el 50%, prioriza packs y no metas ads hasta ver caja.'
        : 'Puedes lanzar rebajas, pero empuja packs antes que descuentos sueltos al 50%.',
      scenarios
    };
  }

  private saleScenario(input: { id: string; title: string; description: string; units: number; grossRevenue: number; productCost: number; shippingCost: number }) {
    const wasteCost = input.productCost * this.wasteRate();
    const shopifyFee = input.grossRevenue * SHOPIFY_FEE_RATE;
    const taxReserve = input.grossRevenue * this.taxReserveRate();
    const netMargin = input.grossRevenue - input.productCost - wasteCost - input.shippingCost - shopifyFee;
    const cashFree = netMargin - taxReserve;
    return {
      id: input.id,
      title: input.title,
      description: input.description,
      units: input.units,
      grossRevenue: this.roundMoney(input.grossRevenue),
      productCost: this.roundMoney(input.productCost),
      wasteCost: this.roundMoney(wasteCost),
      shippingCost: this.roundMoney(input.shippingCost),
      shopifyFee: this.roundMoney(shopifyFee),
      taxReserve: this.roundMoney(taxReserve),
      netMargin: this.roundMoney(netMargin),
      cashFree: this.roundMoney(cashFree),
      marginPct: input.grossRevenue > 0 ? this.roundMoney((netMargin / input.grossRevenue) * 100) : null,
      cashStatus: this.cashStatus(cashFree, input.grossRevenue)
    };
  }

  async fixedExpenses(period?: string) {
    const currentPeriod = this.fixedExpensePeriod(period);
    const range = this.fixedExpensePeriodRange(currentPeriod);
    await this.bank.syncIfStale(range.from, range.to).catch(() => undefined);
    const [expenses, rawBankTransactions] = await Promise.all([
      this.prisma.fixedExpense.findMany({
        include: { payments: { where: { period: currentPeriod } } },
        orderBy: [{ active: 'desc' }, { dueDay: 'asc' }, { name: 'asc' }]
      }),
      this.bank.transactions(range.from, range.to).catch(() => [])
    ]);
    const bankTransactions = this.deduplicateBankTransactions(rawBankTransactions);
    const items = expenses.map((expense) => {
      const payment = expense.payments[0] ?? null;
      const bankReconciliation = payment ? null : this.reconcileFixedExpenseWithBank(expense, bankTransactions);
      const paid = Boolean(payment) || bankReconciliation?.status === 'PAID';
      const paidAt = payment?.paidAt ?? bankReconciliation?.paidAt ?? null;
      const paidAmount = payment?.amount ?? bankReconciliation?.paidAmount ?? null;
      const effectiveAmount = paid && paidAmount != null ? paidAmount : expense.amount;
      return {
        id: expense.id,
        name: expense.name,
        category: expense.category,
        amount: expense.amount,
        currency: expense.currency,
        dueDay: expense.dueDay,
        active: expense.active,
        matcher: expense.matcher,
        notes: expense.notes,
        paid,
        paidAt,
        paidAmount,
        paymentId: payment?.id ?? null,
        paymentSource: payment ? 'MANUAL' : bankReconciliation?.status === 'PAID' ? 'BANK' : null,
        reconciliationStatus: payment ? 'PAID' : bankReconciliation?.status ?? 'PENDING',
        bankTransactionIds: bankReconciliation?.bankTransactionIds ?? [],
        bankDescription: bankReconciliation?.description ?? null,
        rejectedAmount: bankReconciliation?.rejectedAmount ?? null,
        effectiveAmount,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt
      };
    });
    const active = items.filter((item) => item.active);
    const plannedMonthly = +active.reduce((sum, item) => sum + item.amount, 0).toFixed(2);
    const totalMonthly = +active.reduce((sum, item) => sum + item.effectiveAmount, 0).toFixed(2);
    const paid = +active.filter((item) => item.paid).reduce((sum, item) => sum + item.effectiveAmount, 0).toFixed(2);
    const pending = +active.filter((item) => !item.paid).reduce((sum, item) => sum + item.effectiveAmount, 0).toFixed(2);
    const currency = active[0]?.currency ?? items[0]?.currency ?? 'EUR';
    const coverage = this.fixedExpenseCoverage(currentPeriod, totalMonthly, paid, pending, currency);
    const upcoming = active
      .filter((item) => !item.paid)
      .sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99))
      .slice(0, 5);

    return {
      period: currentPeriod,
      currency,
      plannedMonthly,
      totalMonthly,
      paid,
      pending,
      coverage,
      activeCount: active.length,
      paidCount: active.filter((item) => item.paid).length,
      autoReconciledCount: active.filter((item) => item.paymentSource === 'BANK').length,
      rejectedCount: active.filter((item) => item.reconciliationStatus === 'REJECTED').length,
      items,
      upcoming,
      templates: this.fixedExpenseTemplates()
    };
  }

  async extremeSavingsPlan() {
    const plan = await this.ensureExtremeSavingsPlan();
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const [fixedExpenses, contributions, liabilities, orders, currentAdSpend, bankAccounts] = await Promise.all([
      this.fixedExpenses(),
      this.prisma.extremeSavingsContribution.findMany({
        where: { planId: plan.id },
        orderBy: { contributedAt: 'desc' }
      }),
      this.prisma.extremeSavingsLiability.findMany({
        where: { planId: plan.id, active: true },
        orderBy: [{ priority: 'asc' }, { name: 'asc' }]
      }),
      this.prisma.order.findMany({
        where: {
          orderedAt: { gte: plan.revenueStartAt, lte: now },
          operationalStatus: { not: OperationalStatus.CANCELLED }
        },
        include: { items: true, shipments: true },
        orderBy: { orderedAt: 'asc' }
      }),
      this.meta.spendForRange(currentMonthStart.toISOString().slice(0, 10), now.toISOString().slice(0, 10)).catch(() => 0),
      this.bank.accounts().catch(() => ({
        currency: 'EUR',
        totalBalance: 0,
        balanceAvailable: false,
        accounts: [] as Array<Record<string, unknown>>
      }))
    ]);

    const activeOrders = orders.filter((order) => !['refunded', 'voided', 'cancelled'].includes(String(order.financialStatus ?? '').toLowerCase()));
    const breakdowns = activeOrders.map((order) => this.computeOrderBreakdown(order));
    const trackedRevenue = this.roundMoney(breakdowns.reduce((sum, item) => sum + item.grossRevenue, 0));
    const reportedRevenue = this.roundMoney(plan.reportedRevenue);
    const trackedDataIsComplete = trackedRevenue >= reportedRevenue * 0.8;
    const historicalRevenue = trackedDataIsComplete ? trackedRevenue : Math.max(trackedRevenue, reportedRevenue);
    const monthsTracked = this.inclusiveMonthCount(plan.revenueStartAt, now);
    const averageMonthlyRevenue = this.roundMoney(historicalRevenue / Math.max(1, monthsTracked));

    const historicalProductCost = breakdowns.reduce((sum, item) => sum + item.productCost, 0);
    const historicalWasteCost = breakdowns.reduce((sum, item) => sum + item.wasteCost, 0);
    const historicalShippingCost = breakdowns.reduce((sum, item) => sum + item.shippingCost, 0);
    const historicalShopifyFees = breakdowns.reduce((sum, item) => sum + item.shopifyFee, 0);
    const historicalTaxReserve = breakdowns.reduce((sum, item) => sum + item.taxReserve, 0);
    const historicalVariableCost = historicalProductCost + historicalWasteCost + historicalShippingCost + historicalShopifyFees + historicalTaxReserve;
    const fallbackVariableRate = this.productionRate() + this.shippingRate() + SHOPIFY_FEE_RATE + this.taxReserveRate();
    const variableRate = trackedRevenue > 0
      ? Math.min(0.75, Math.max(0, historicalVariableCost / trackedRevenue))
      : fallbackVariableRate;

    const currentBreakdowns = breakdowns.filter((item) => item.orderedAt >= currentMonthStart);
    const currentRevenue = this.roundMoney(currentBreakdowns.reduce((sum, item) => sum + item.grossRevenue, 0));
    const currentVariableCost = this.roundMoney(
      currentBreakdowns.reduce((sum, item) => sum + item.productCost + item.wasteCost + item.shippingCost + item.shopifyFee + item.taxReserve, 0)
      + currentAdSpend
    );

    const recordedSavingsAmount = this.roundMoney(contributions.reduce((sum, contribution) => sum + contribution.amount, 0));
    const savingsAccounts = bankAccounts.accounts.filter((account: any) => this.isSavingsBankAccount(account));
    const detectedSavingsAmount = this.roundMoney(savingsAccounts.reduce((sum: number, account: any) => {
      const balance = account.currentBalance ?? account.availableBalance ?? 0;
      return sum + Math.max(0, Number(balance) || 0);
    }, 0));
    // A manual movement may describe the same money held in the savings account.
    // Taking the greater amount prevents counting it twice.
    const savedAmount = this.roundMoney(Math.max(recordedSavingsAmount, detectedSavingsAmount));
    const remainingGoal = this.roundMoney(Math.max(0, plan.goalAmount - savedAmount));
    const liabilityItems = liabilities.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      originalAmount: this.roundMoney(item.originalAmount),
      paidAmount: this.roundMoney(item.paidAmount),
      remainingAmount: this.roundMoney(Math.max(0, item.originalAmount - item.paidAmount)),
      monthlyPayment: item.monthlyPayment == null ? null : this.roundMoney(item.monthlyPayment),
      interestRate: item.interestRate,
      priority: item.priority,
      notes: item.notes
    }));
    const liabilitiesOriginal = this.roundMoney(liabilityItems.reduce((sum, item) => sum + item.originalAmount, 0));
    const liabilitiesPaid = this.roundMoney(liabilityItems.reduce((sum, item) => sum + item.paidAmount, 0));
    const liabilitiesRemaining = this.roundMoney(liabilityItems.reduce((sum, item) => sum + item.remainingAmount, 0));

    const fixedRate = averageMonthlyRevenue > 0 ? Math.min(1, fixedExpenses.totalMonthly / averageMonthlyRevenue) : 0;
    const debtRate = liabilitiesRemaining > 0 ? 0.20 : 0;
    const minimumBufferRate = 0.05;
    const roomForSavings = Math.max(0, 1 - variableRate - fixedRate - debtRate - minimumBufferRate);
    const recommendedSavingsRate = Math.min(0.20, roomForSavings);
    const afterDebtSavingsRate = Math.min(0.25, Math.max(0, 1 - variableRate - fixedRate - minimumBufferRate));
    const operationsRate = Math.max(0, 1 - variableRate - fixedRate - debtRate - recommendedSavingsRate);
    const monthlySavingsTarget = this.roundMoney(averageMonthlyRevenue * recommendedSavingsRate);
    const monthsToGoal = monthlySavingsTarget > 0 ? Math.ceil(remainingGoal / monthlySavingsTarget) : null;
    const targetDate = monthsToGoal == null ? null : this.addMonths(now, monthsToGoal).toISOString();
    const currentDebtTarget = this.roundMoney(Math.min(liabilitiesRemaining, currentRevenue * debtRate));
    const currentSavingsTarget = this.roundMoney(currentRevenue * recommendedSavingsRate);
    const currentAvailableAfterMandatory = this.roundMoney(Math.max(0, currentRevenue - currentVariableCost - fixedExpenses.totalMonthly - currentDebtTarget));
    const safeSavingsThisMonth = this.roundMoney(Math.min(currentSavingsTarget, currentAvailableAfterMandatory));

    const bankBalanceAvailable = Boolean(bankAccounts.balanceAvailable);
    const bankTotalBalance = this.roundMoney(bankAccounts.totalBalance ?? 0);
    const operatingBalance = this.roundMoney(bankTotalBalance - detectedSavingsAmount);
    const safetyBuffer = this.roundMoney(this.cashSafetyBuffer());
    const pendingFixedExpenses = this.roundMoney(fixedExpenses.pending);
    const protectedCash = this.roundMoney(pendingFixedExpenses + safetyBuffer);
    const availableForAllocation = this.roundMoney(Math.max(0, operatingBalance - protectedCash));
    const cashShortfall = this.roundMoney(Math.max(0, protectedCash - operatingBalance));
    const savingsSource = detectedSavingsAmount > 0 && detectedSavingsAmount >= recordedSavingsAmount
      ? 'BANK'
      : recordedSavingsAmount > 0
        ? 'MANUAL'
        : 'NONE';
    const bankAccountItems = bankAccounts.accounts.map((account: any) => ({
      id: account.id,
      name: account.name,
      institutionName: account.institutionName ?? null,
      currency: account.currency ?? bankAccounts.currency ?? 'EUR',
      balance: account.currentBalance ?? account.availableBalance ?? null,
      isSavings: this.isSavingsBankAccount(account),
      balanceUpdatedAt: account.balanceUpdatedAt ?? null,
      balanceError: account.balanceError ?? null
    }));

    const fixedItems = fixedExpenses.items.map((item: any) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      amount: this.roundMoney(item.amount),
      dueDay: item.dueDay,
      active: item.active,
      notes: item.notes
    }));

    return {
      currency: fixedExpenses.currency ?? 'EUR',
      plan: {
        id: plan.id,
        goalAmount: this.roundMoney(plan.goalAmount),
        savedAmount,
        remainingGoal,
        progressPct: plan.goalAmount > 0 ? this.roundMoney((savedAmount / plan.goalAmount) * 100) : 100,
        revenueStartAt: plan.revenueStartAt,
        monthsToGoal,
        targetDate
      },
      bank: {
        connected: bankAccounts.accounts.length > 0,
        balanceAvailable: bankBalanceAvailable,
        currency: bankAccounts.currency ?? fixedExpenses.currency ?? 'EUR',
        totalBalance: bankTotalBalance,
        operatingBalance,
        detectedSavingsAmount,
        recordedSavingsAmount,
        effectiveSavingsAmount: savedAmount,
        savingsSource,
        pendingFixedExpenses,
        safetyBuffer,
        protectedCash,
        availableForAllocation,
        cashShortfall,
        accounts: bankAccountItems,
        recommendation: !bankAccounts.accounts.length
          ? 'Conecta el banco en la pestaña Banco para calcular la caja real.'
          : !bankBalanceAvailable
            ? 'La cuenta está conectada, pero no se ha podido leer el saldo. Sincroniza o renueva el permiso bancario.'
            : savingsAccounts.length === 0
              ? 'No se ha detectado una cuenta de ahorro. Pon “Ahorro” o “Ahorro 15K” en el nombre del espacio para contarla automáticamente.'
              : cashShortfall > 0
                ? `Faltan ${cashShortfall.toFixed(2)} € para cubrir los gastos fijos pendientes y el colchón mínimo.`
                : 'La caja operativa cubre los gastos fijos pendientes y el colchón mínimo.'
      },
      revenue: {
        trackedRevenue,
        reportedRevenue,
        historicalRevenue: this.roundMoney(historicalRevenue),
        source: trackedDataIsComplete ? 'ORDERS' : 'REPORTED',
        monthsTracked,
        averageMonthlyRevenue,
        currentMonthRevenue: currentRevenue,
        orderCount: breakdowns.length
      },
      costs: {
        fixed: {
          monthlyTotal: this.roundMoney(fixedExpenses.totalMonthly),
          ratePct: this.roundMoney(fixedRate * 100),
          activeCount: fixedExpenses.activeCount,
          items: fixedItems
        },
        variable: {
          historicalTotal: this.roundMoney(historicalVariableCost),
          currentMonthTotal: currentVariableCost,
          currentAdSpend: this.roundMoney(currentAdSpend),
          ratePct: this.roundMoney(variableRate * 100),
          items: this.extremeSavingsVariableCosts()
        },
        liabilities: {
          originalTotal: liabilitiesOriginal,
          paidTotal: liabilitiesPaid,
          remainingTotal: liabilitiesRemaining,
          items: liabilityItems
        }
      },
      allocation: {
        variablePct: this.roundMoney(variableRate * 100),
        fixedPct: this.roundMoney(fixedRate * 100),
        debtPct: this.roundMoney(debtRate * 100),
        savingsPct: this.roundMoney(recommendedSavingsRate * 100),
        operationsPct: this.roundMoney(operationsRate * 100),
        afterDebtSavingsPct: this.roundMoney(afterDebtSavingsRate * 100),
        monthlySavingsTarget,
        perHundred: [
          { key: 'VARIABLE', label: 'Producción, envíos, Shopify e impuestos', amount: this.roundMoney(variableRate * 100), color: 'BLUE' },
          { key: 'FIXED', label: 'Gastos fijos', amount: this.roundMoney(fixedRate * 100), color: 'AMBER' },
          { key: 'DEBT', label: 'Deuda y atrasos', amount: this.roundMoney(debtRate * 100), color: 'RED' },
          { key: 'SAVINGS', label: 'Ahorro 15.000 €', amount: this.roundMoney(recommendedSavingsRate * 100), color: 'GREEN' },
          { key: 'OPERATIONS', label: 'Colchón operativo', amount: this.roundMoney(operationsRate * 100), color: 'PURPLE' }
        ],
        headline: recommendedSavingsRate >= 0.20
          ? 'El 20% de cada cobro puede ir directo al ahorro.'
          : `Ahora mismo el porcentaje prudente es ${this.roundMoney(recommendedSavingsRate * 100)}%.`,
        recommendation: liabilitiesRemaining > 0
          ? 'Separa el ahorro al cobrar y usa el bloque de deuda para poner al día luz e internet; después acelera Cetelem. Cuando terminen, el porcentaje de ahorro sube automáticamente.'
          : 'Sin atrasos pendientes, aumenta el traspaso de ahorro hasta el porcentaje posterior a deuda.'
      },
      currentMonth: {
        revenue: currentRevenue,
        variableCost: currentVariableCost,
        fixedCost: this.roundMoney(fixedExpenses.totalMonthly),
        debtTarget: currentDebtTarget,
        savingsTarget: currentSavingsTarget,
        safeSavings: safeSavingsThisMonth,
        availableAfterMandatory: currentAvailableAfterMandatory
      },
      contributions: contributions.map((item) => ({
        id: item.id,
        amount: this.roundMoney(item.amount),
        contributedAt: item.contributedAt,
        notes: item.notes
      }))
    };
  }

  async addExtremeSavingsContribution(body: { amount?: number; contributedAt?: string; notes?: string | null }) {
    const plan = await this.ensureExtremeSavingsPlan();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('El ahorro debe ser mayor que cero');
    return this.prisma.extremeSavingsContribution.create({
      data: {
        planId: plan.id,
        amount: this.money(amount),
        contributedAt: body.contributedAt ? new Date(body.contributedAt) : new Date(),
        notes: body.notes?.trim() || null
      }
    });
  }

  async deleteExtremeSavingsContribution(id: string) {
    await this.prisma.extremeSavingsContribution.deleteMany({ where: { id, planId: EXTREME_SAVINGS_PLAN_ID } });
    return { ok: true, id };
  }

  async payExtremeSavingsLiability(id: string, body: { amount?: number }) {
    await this.ensureExtremeSavingsPlan();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('El pago debe ser mayor que cero');
    const liability = await this.prisma.extremeSavingsLiability.findFirst({ where: { id, planId: EXTREME_SAVINGS_PLAN_ID, active: true } });
    if (!liability) throw new BadRequestException('Deuda no encontrada');
    return this.prisma.extremeSavingsLiability.update({
      where: { id },
      data: { paidAmount: this.roundMoney(Math.min(liability.originalAmount, liability.paidAmount + amount)) }
    });
  }

  async retroAstonPlan() {
    const preorderKey = this.retroAstonPreorderKey();
    const milestones = this.retroAstonMilestones();
    const payments = await this.prisma.preorderPayment.findMany({
      where: { preorderKey },
      orderBy: { milestone: 'asc' }
    });
    const paidByMilestone = new Map(payments.map((payment) => [payment.milestone, payment]));
    const orders = await this.prisma.order.findMany({
      where: { operationalStatus: { not: OperationalStatus.CANCELLED } },
      include: { items: true }
    });
    const activeOrders = orders.filter((order) => !['refunded', 'voided', 'cancelled'].includes(String(order.financialStatus ?? '').toLowerCase()));
    const soldUnits = activeOrders.reduce((sum, order) => sum + this.retroAstonUnits(order), 0);
    const orderCount = activeOrders.filter((order) => this.retroAstonUnits(order) > 0).length;
    const unitCost = this.retroAstonUnitCost();
    const totalCommitment = this.retroAstonTotalCommitment();
    const totalReservedFromSales = +(soldUnits * unitCost).toFixed(2);
    const paidTotal = +payments.reduce((sum, payment) => sum + this.money(payment.amount), 0).toFixed(2);
    const fundAvailable = +Math.max(0, totalReservedFromSales - paidTotal).toFixed(2);
    const items = milestones.map((milestone) => {
      const payment = paidByMilestone.get(milestone.milestone);
      return {
        ...milestone,
        currency: 'EUR',
        paid: Boolean(payment),
        paidAt: payment?.paidAt ?? null,
        paidAmount: payment?.amount ?? null,
        notes: payment?.notes ?? null
      };
    });
    const nextMilestone = items.find((item) => !item.paid) ?? null;
    const missingForNext = nextMilestone ? +Math.max(0, nextMilestone.amount - fundAvailable).toFixed(2) : 0;

    return {
      key: preorderKey,
      title: 'Retro Aston',
      currency: 'EUR',
      totalCommitment,
      installmentAmount: this.retroAstonInstallmentAmount(),
      scheduledTotal: +milestones.reduce((sum, milestone) => sum + milestone.amount, 0).toFixed(2),
      adjustmentAmount: +Math.max(0, totalCommitment - milestones.reduce((sum, milestone) => sum + milestone.amount, 0)).toFixed(2),
      unitCost,
      sellingPrice: this.retroAstonSellingPrice(),
      soldUnits,
      orderCount,
      totalReservedFromSales,
      paidTotal,
      fundAvailable,
      remainingCommitment: +Math.max(0, totalCommitment - paidTotal).toFixed(2),
      coveredTotal: +Math.min(totalCommitment, paidTotal + fundAvailable).toFixed(2),
      nextMilestone,
      missingForNext,
      canPayNext: Boolean(nextMilestone && fundAvailable >= nextMilestone.amount),
      milestones: items
    };
  }

  async markRetroAstonPayment(milestone: number, body: { amount?: number; paidAt?: string; notes?: string | null }) {
    const definition = this.retroAstonMilestones().find((item) => item.milestone === milestone);
    if (!definition) throw new BadRequestException('Cuota de preventa inválida');
    return this.prisma.preorderPayment.upsert({
      where: { preorderKey_milestone: { preorderKey: this.retroAstonPreorderKey(), milestone } },
      create: {
        preorderKey: this.retroAstonPreorderKey(),
        milestone,
        label: definition.label,
        amount: this.money(body.amount ?? definition.amount),
        currency: 'EUR',
        dueAt: definition.dueAt,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        notes: body.notes ?? null
      },
      update: {
        label: definition.label,
        amount: this.money(body.amount ?? definition.amount),
        dueAt: definition.dueAt,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        notes: body.notes ?? null
      }
    });
  }

  async unmarkRetroAstonPayment(milestone: number) {
    await this.prisma.preorderPayment.deleteMany({
      where: { preorderKey: this.retroAstonPreorderKey(), milestone }
    });
    return { ok: true, milestone };
  }

  async createFixedExpense(body: {
    name: string;
    category: string;
    amount: number;
    currency?: string;
    dueDay?: number | null;
    matcher?: string | null;
    notes?: string | null;
  }) {
    return this.prisma.fixedExpense.create({
      data: this.fixedExpenseData(body)
    });
  }

  async updateFixedExpense(id: string, body: {
    name?: string;
    category?: string;
    amount?: number;
    currency?: string;
    dueDay?: number | null;
    active?: boolean;
    matcher?: string | null;
    notes?: string | null;
  }) {
    return this.prisma.fixedExpense.update({
      where: { id },
      data: this.fixedExpenseData(body, true)
    });
  }

  async deleteFixedExpense(id: string) {
    await this.prisma.fixedExpense.delete({ where: { id } });
    return { ok: true, id };
  }

  async markFixedExpensePaid(id: string, body: { period?: string; amount?: number; paidAt?: string; notes?: string | null }) {
    const expense = await this.prisma.fixedExpense.findUnique({ where: { id } });
    if (!expense) return null;
    const period = this.fixedExpensePeriod(body.period);
    return this.prisma.fixedExpensePayment.upsert({
      where: { fixedExpenseId_period: { fixedExpenseId: id, period } },
      create: {
        fixedExpenseId: id,
        period,
        amount: this.money(body.amount ?? expense.amount),
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        notes: body.notes ?? null
      },
      update: {
        amount: this.money(body.amount ?? expense.amount),
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        notes: body.notes ?? null
      }
    });
  }

  async unmarkFixedExpensePaid(id: string, period?: string) {
    const currentPeriod = this.fixedExpensePeriod(period);
    await this.prisma.fixedExpensePayment.deleteMany({ where: { fixedExpenseId: id, period: currentPeriod } });
    return { ok: true, id, period: currentPeriod };
  }

  private async adsReserveForSalesDays(days: string[]) {
    const uniqueDays = [...new Set(days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))];
    const values = await Promise.all(uniqueDays.map((day) => this.meta.spendForRange(day, day).catch(() => 0)));
    return +values.reduce((sum, value) => sum + value, 0).toFixed(2);
  }

  private retroAstonTotalCommitment() {
    return 2194.94;
  }

  private retroAstonPreorderKey() {
    return 'RETRO_ASTON';
  }

  private retroAstonInstallmentAmount() {
    return 1200;
  }

  private retroAstonMilestones() {
    const initialPayment = this.retroAstonInstallmentAmount();
    const finalPayment = +Math.max(0, this.retroAstonTotalCommitment() - initialPayment).toFixed(2);

    return [
      {
        milestone: 1,
        label: 'Entrada producción',
        amount: initialPayment,
        dueAt: null as Date | null
      },
      {
        milestone: 2,
        label: 'Resto al finalizar',
        amount: finalPayment,
        dueAt: null as Date | null
      }
    ];
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

  private async ensureExtremeSavingsPlan() {
    let plan = await this.prisma.extremeSavingsPlan.upsert({
      where: { id: EXTREME_SAVINGS_PLAN_ID },
      create: {
        id: EXTREME_SAVINGS_PLAN_ID,
        goalAmount: 15000,
        reportedRevenue: 114000,
        revenueStartAt: new Date('2025-11-01T00:00:00.000Z')
      },
      update: {}
    });

    if (plan.seedVersion >= EXTREME_SAVINGS_SEED_VERSION) return plan;

    const fixedSeeds = [
      { name: 'Alquiler taller', aliases: ['Alquiler'], category: 'ALQUILER', amount: 363, dueDay: 10, active: true, matcher: 'hermarca 2001|customwear', notes: 'Pago entre los días 1 y 10.' },
      { name: 'Luz taller (estimación)', aliases: ['Luz'], category: 'SUMINISTROS', amount: 91.18, dueDay: null, active: true, matcher: 'octopus energy', notes: 'Media provisional de las cinco facturas pendientes. Ajustar cuando llegue una factura mensual normal.' },
      { name: 'Internet taller', aliases: ['Internet'], category: 'TELECOM', amount: 36, dueDay: null, active: true, matcher: null, notes: 'Cuota mensual habitual.' },
      { name: 'Cuota autónomos', aliases: ['Autónomos', 'Autonomos'], category: 'AUTONOMOS', amount: 150, dueDay: null, active: true, matcher: 'tgss|tesoreria general seguridad social|seguridad social', notes: 'Cuota mensual.' },
      { name: 'Préstamo Retro / Cetelem', aliases: ['Préstamo', 'Prestamo'], category: 'DEUDA', amount: 85, dueDay: 3, active: true, matcher: 'cetelem|bnp paribas', notes: 'Pago mínimo mensual. El plan añade amortización extraordinaria para reducir intereses.' },
      { name: 'Shopify', aliases: [], category: 'SOFTWARE', amount: 70, dueDay: null, active: true, matcher: 'paypal shopify', notes: 'Estimación mensual.' },
      { name: 'Klaviyo', aliases: [], category: 'SOFTWARE', amount: 129.46, dueDay: 11, active: true, matcher: 'klaviyo', notes: 'Ciclo de facturación mensual iniciado el día 11.' },
      { name: 'Dominio web', aliases: ['Dominio'], category: 'SOFTWARE', amount: 5.99, dueDay: 27, active: true, matcher: 'tesys internet', notes: 'Renovación mensual.' },
      { name: 'Canva', aliases: [], category: 'SOFTWARE', amount: 16, dueDay: null, active: true, matcher: 'canva', notes: 'Suscripción mensual.' },
      { name: 'ChatGPT', aliases: [], category: 'SOFTWARE', amount: 19, dueDay: null, active: true, matcher: 'openai|chatgpt', notes: 'Suscripción mensual.' },
      { name: 'Diseñador - pack 3 diseños', aliases: ['Diseñador'], category: 'DISENO', amount: 365, dueDay: null, active: false, matcher: null, notes: 'Condicional: activar solo el mes en que se encarguen tres diseños.' },
      { name: 'Agua', aliases: [], category: 'SUMINISTROS', amount: 0, dueDay: null, active: false, matcher: null, notes: 'Actualmente sin coste.' },
      { name: 'Gestoría', aliases: ['Gestoria'], category: 'GESTORIA', amount: 0, dueDay: null, active: false, matcher: null, notes: 'Actualmente sin coste.' },
      { name: 'Seguro', aliases: [], category: 'SEGUROS', amount: 0, dueDay: null, active: false, matcher: null, notes: 'Actualmente sin coste.' }
    ];

    await this.prisma.$transaction(async (tx) => {
      for (const seed of fixedSeeds) {
        const names = [seed.name, ...seed.aliases];
        const existing = await tx.fixedExpense.findFirst({ where: { name: { in: names, mode: 'insensitive' } } });
        const data = {
          name: seed.name,
          category: seed.category,
          amount: seed.amount,
          currency: 'EUR',
          dueDay: seed.dueDay,
          active: seed.active,
          matcher: seed.matcher,
          notes: seed.notes
        };
        if (existing) await tx.fixedExpense.update({ where: { id: existing.id }, data });
        else await tx.fixedExpense.create({ data });
      }

      for (const liability of [
        {
          id: 'extreme-cetelem-retro',
          name: 'Deuda Retro / Cetelem',
          category: 'DEUDA_INTERESES',
          originalAmount: 2738.48,
          monthlyPayment: 85,
          interestRate: 19.56,
          priority: 3,
          notes: 'Deuda cara por su TAE. Acelerar al terminar los atrasos de suministros, sin dejar descubiertos alquiler ni pedidos.'
        },
        {
          id: 'extreme-electricity-arrears',
          name: 'Facturas de luz pendientes',
          category: 'ATRASO_SUMINISTROS',
          originalAmount: 455.91,
          monthlyPayment: null,
          interestRate: null,
          priority: 1,
          notes: '54,73 + 46,37 + 41,37 + 135,30 + 178,14 €.'
        },
        {
          id: 'extreme-internet-arrears',
          name: 'Facturas de internet pendientes',
          category: 'ATRASO_TELECOM',
          originalAmount: 172.52,
          monthlyPayment: null,
          interestRate: null,
          priority: 2,
          notes: '28,52 + 36 + 36 + 36 + 36 €.'
        }
      ]) {
        await tx.extremeSavingsLiability.upsert({
          where: { id: liability.id },
          create: { ...liability, planId: plan.id },
          update: {
            name: liability.name,
            category: liability.category,
            originalAmount: liability.originalAmount,
            monthlyPayment: liability.monthlyPayment,
            interestRate: liability.interestRate,
            priority: liability.priority,
            notes: liability.notes,
            active: true
          }
        });
      }

      await tx.extremeSavingsPlan.update({
        where: { id: plan.id },
        data: { seedVersion: EXTREME_SAVINGS_SEED_VERSION }
      });
    });

    plan = await this.prisma.extremeSavingsPlan.findUniqueOrThrow({ where: { id: plan.id } });
    return plan;
  }

  private extremeSavingsVariableCosts() {
    return [
      { id: 'tee-white', name: 'Camiseta blanca normal', amount: 3.23, unit: 'POR_UNIDAD', notes: 'Prenda 2,73 € + impresión 0,50 €.' },
      { id: 'tee-black', name: 'Camiseta negra normal', amount: 5.43, unit: 'POR_UNIDAD', notes: 'Prenda 2,73 € + DTF 2,70 €.' },
      { id: 'tee-boxy', name: 'Camiseta blanca BOXY', amount: 5.40, unit: 'POR_UNIDAD', notes: 'Prenda 4,90 € + impresión 0,50 €. Costes trabajados sin IVA recuperable.' },
      { id: 'sweatshirt-white', name: 'Sudadera blanca', amount: 11.25, unit: 'POR_UNIDAD', notes: 'Prenda 10,75 € + impresión estimada 0,50 €.' },
      { id: 'sweatshirt-color', name: 'Sudadera negra o Light Pink', amount: 13.45, unit: 'POR_UNIDAD', notes: 'Prenda 10,75 € + DTF 2,70 €.' },
      { id: 'swimsuit', name: 'Bañador', amount: 7.43, unit: 'POR_UNIDAD', notes: 'Prenda 4,725 € + DTF 2,70 €.' },
      { id: 'shipping-light', name: 'Envío ligero España', amount: 3.31, unit: 'POR_ENVIO', notes: 'Reserva según método real.' },
      { id: 'shipping-standard', name: 'Envío estándar España', amount: 3.81, unit: 'POR_ENVIO', notes: 'Reserva según método real.' },
      { id: 'shipping-premium', name: 'Envío premium España', amount: 4.26, unit: 'POR_ENVIO', notes: 'Reserva según método real.' },
      { id: 'shipping-heavy', name: 'Envío España 1-2 kg', amount: 3.98, unit: 'POR_ENVIO', notes: 'Reserva para pedidos de mayor peso.' },
      { id: 'shipping-international', name: 'Envío internacional', amount: 12.45, unit: 'POR_ENVIO', notes: 'Estimación base.' },
      { id: 'shopify-fee', name: 'Comisión Shopify Payments', amount: SHOPIFY_FEE_RATE * 100, unit: 'PORCENTAJE_VENTA', notes: '2,4% sobre ventas cobradas.' },
      { id: 'tax-reserve', name: 'Reserva fiscal', amount: this.taxReserveRate() * 100, unit: 'PORCENTAJE_VENTA', notes: 'Dinero intocable para impuestos.' },
      { id: 'waste', name: 'Merma de producción', amount: this.wasteRate() * 100, unit: 'PORCENTAJE_PRODUCCION', notes: 'Reserva para errores y prendas dañadas.' },
      { id: 'designer', name: 'Diseñador - 3 diseños', amount: 365, unit: 'POR_ENCARGO', notes: 'Solo se cuenta cuando se contrata.' },
      { id: 'ads', name: 'Publicidad', amount: 0, unit: 'VARIABLE', notes: 'Actualmente sin campañas. El gasto real se suma automáticamente cuando Meta tenga actividad.' }
    ];
  }

  private inclusiveMonthCount(start: Date, end: Date) {
    return Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
  }

  private addMonths(date: Date, months: number) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }

  private isSavingsBankAccount(account: { name?: string | null; product?: string | null; cashAccountType?: string | null }) {
    const text = this.normalizeSearchText([account.name, account.product, account.cashAccountType].filter(Boolean).join(' '));
    return ['ahorro', 'savings', 'saving', 'vault', 'hucha', '15k', '15000'].some((keyword) => text.includes(keyword));
  }

  private normalizeSearchText(value: string) {
    return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }

  private fixedExpensePeriodRange(period: string) {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      from: `${period}-01`,
      to: `${period}-${String(lastDay).padStart(2, '0')}`
    };
  }

  private deduplicateBankTransactions(transactions: any[]) {
    const seen = new Set<string>();
    return transactions.filter((transaction) => {
      const text = this.bankTransactionSearchText(transaction)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const date = new Date(transaction.bookingDate).toISOString().slice(0, 10);
      const signature = [transaction.accountId, date, Number(transaction.amount).toFixed(2), text].join('|');
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  private reconcileFixedExpenseWithBank(expense: any, transactions: any[]) {
    const matchers = this.fixedExpenseMatcherTokens(expense);
    if (matchers.length === 0) return { status: 'PENDING' as const };

    const matches = transactions.filter((transaction) => {
      if (Number(transaction.amount) >= 0) return false;
      const text = this.bankTransactionSearchText(transaction);
      if (this.isInternalBankTransfer(text)) return false;
      return matchers.some((matcher) => text.includes(matcher));
    });
    const paidMatches = matches.filter((transaction) => !this.isRejectedBankTransaction(transaction));

    if (paidMatches.length > 0) {
      const paidAmount = this.roundMoney(paidMatches.reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount) || 0), 0));
      const paidAt = paidMatches
        .map((transaction) => new Date(transaction.bookingDate))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        status: 'PAID' as const,
        paidAt,
        paidAmount,
        bankTransactionIds: paidMatches.map((transaction) => transaction.id),
        description: paidMatches.map((transaction) => transaction.description).filter(Boolean).join(' | ')
      };
    }

    const rejectedMatches = matches.filter((transaction) => this.isRejectedBankTransaction(transaction));
    if (rejectedMatches.length > 0) {
      const description = rejectedMatches.map((transaction) => transaction.description).filter(Boolean).join(' | ');
      return {
        status: 'REJECTED' as const,
        bankTransactionIds: rejectedMatches.map((transaction) => transaction.id),
        description,
        rejectedAmount: this.rejectedBankAmount(description)
      };
    }

    return { status: 'PENDING' as const };
  }

  private fixedExpenseMatcherTokens(expense: any) {
    const explicit = String(expense.matcher ?? '')
      .split('|')
      .map((value) => this.normalizeSearchText(value).replace(/[^a-z0-9]+/g, ' ').trim())
      .filter(Boolean);
    if (explicit.length > 0) return explicit;

    const name = this.normalizeSearchText(String(expense.name ?? ''));
    if (name.includes('alquiler')) return ['hermarca 2001', 'customwear'];
    if (name.includes('luz')) return ['octopus energy'];
    if (name.includes('autonom')) return ['tgss', 'tesoreria general seguridad social', 'seguridad social'];
    if (name.includes('prestamo') || name.includes('cetelem')) return ['cetelem', 'bnp paribas'];
    if (name.includes('shopify')) return ['paypal shopify'];
    if (name.includes('klaviyo')) return ['klaviyo'];
    if (name.includes('dominio')) return ['tesys internet'];
    if (name.includes('canva')) return ['canva'];
    if (name.includes('chatgpt')) return ['openai', 'chatgpt'];
    return [];
  }

  private bankTransactionSearchText(transaction: any) {
    return this.normalizeSearchText([
      transaction.description,
      transaction.merchantName,
      transaction.counterpartyName,
      transaction.remittanceInfo
    ].filter(Boolean).join(' ')).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private isRejectedBankTransaction(transaction: any) {
    const text = this.bankTransactionSearchText(transaction);
    return /rechazad|rejected|denegad|devuelt|returned direct debit/.test(text);
  }

  private rejectedBankAmount(description: string) {
    const normalized = description.replace(',', '.');
    const explicit = normalized.match(/(?:sepa|domiciliad[oa]|direct debit)[^0-9]{0,24}(\d+(?:\.\d{1,2})?)/i);
    if (!explicit) return null;
    const value = Number(explicit[1]);
    return Number.isFinite(value) ? this.roundMoney(value) : null;
  }

  private isInternalBankTransfer(text: string) {
    return /(?:de|desde) cuenta .* (?:a|hacia) cuenta|internal transfer|traspaso entre cuentas/.test(text);
  }

  private fixedExpensePeriod(period?: string) {
    if (period && /^\d{4}-\d{2}$/.test(period)) return period;
    return new Date().toISOString().slice(0, 7);
  }

  private fixedExpenseData(body: any, partial = false) {
    const data: any = {};
    if (!partial || body.name !== undefined) data.name = this.requiredText(body.name, 'Nombre');
    if (!partial || body.category !== undefined) data.category = this.requiredText(body.category, 'Categoría').toUpperCase();
    if (!partial || body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Importe inválido');
      data.amount = this.money(amount);
    }
    if (body.currency !== undefined) data.currency = body.currency || 'EUR';
    else if (!partial) data.currency = 'EUR';
    if (body.dueDay !== undefined) {
      const dueDay = body.dueDay == null ? null : Number(body.dueDay);
      data.dueDay = dueDay == null || !Number.isFinite(dueDay) ? null : Math.min(31, Math.max(1, Math.round(dueDay)));
    }
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.matcher !== undefined) data.matcher = body.matcher?.trim() || null;
    if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
    return data;
  }

  private requiredText(value: unknown, label: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${label} obligatorio`);
    return text;
  }

  private fixedExpenseTemplates() {
    return [
      { name: 'Alquiler', category: 'ALQUILER', icon: 'house.fill' },
      { name: 'Luz', category: 'SUMINISTROS', icon: 'bolt.fill' },
      { name: 'Agua', category: 'SUMINISTROS', icon: 'drop.fill' },
      { name: 'Internet', category: 'TELECOM', icon: 'wifi' },
      { name: 'Trabajadores', category: 'NOMINAS', icon: 'person.2.fill' },
      { name: 'Autónomos', category: 'AUTONOMOS', icon: 'person.crop.circle.badge.checkmark' },
      { name: 'Gestoría', category: 'GESTORIA', icon: 'folder.fill' },
      { name: 'Software', category: 'SOFTWARE', icon: 'desktopcomputer' },
      { name: 'Seguro', category: 'SEGUROS', icon: 'shield.fill' }
    ];
  }

  private fixedExpenseCoverage(period: string, totalMonthly: number, paid: number, pending: number, currency: string) {
    const [year, month] = period.split('-').map((part) => Number(part));
    const now = new Date();
    const validPeriod = Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12;
    const daysInMonth = validPeriod ? new Date(year, month, 0).getDate() : 30;
    const isCurrentPeriod = validPeriod && now.getFullYear() === year && now.getMonth() + 1 === month;
    const elapsedDays = isCurrentPeriod ? Math.min(daysInMonth, Math.max(1, now.getDate())) : daysInMonth;
    const daysRemaining = isCurrentPeriod ? Math.max(1, daysInMonth - elapsedDays + 1) : 0;
    const monthlyDailyTarget = totalMonthly > 0 ? this.roundMoney(totalMonthly / daysInMonth) : 0;
    const expectedCoveredByToday = this.roundMoney(monthlyDailyTarget * elapsedDays);
    const paceDelta = this.roundMoney(paid - expectedCoveredByToday);
    const coveragePct = totalMonthly > 0 ? this.roundMoney((paid / totalMonthly) * 100) : 100;
    const coveredUntilDay = totalMonthly > 0
      ? Math.min(daysInMonth, Math.max(0, Math.floor((paid / totalMonthly) * daysInMonth)))
      : daysInMonth;
    const dailyRequired = pending > 0 && daysRemaining > 0 ? this.roundMoney(pending / daysRemaining) : 0;

    let paceStatus: 'COVERED' | 'AHEAD' | 'ON_TRACK' | 'BEHIND' = 'COVERED';
    if (pending > 0) {
      if (paceDelta >= monthlyDailyTarget) paceStatus = 'AHEAD';
      else if (paceDelta >= -monthlyDailyTarget * 2) paceStatus = 'ON_TRACK';
      else paceStatus = 'BEHIND';
    }

    let headline: string;
    let recommendation: string;
    if (totalMonthly <= 0) {
      headline = 'Añade tus gastos fijos para saber qué caja no puedes tocar.';
      recommendation = 'Mete alquiler, luz, autónomos, internet y trabajadores para que Caja separe operaciones antes de hablar de beneficio.';
    } else if (pending <= 0) {
      headline = 'Gastos fijos cubiertos este mes.';
      recommendation = 'Ya puedes mirar la caja libre con más tranquilidad. Mantén los pagos marcados cuando entren nuevos gastos.';
    } else if (paceStatus === 'BEHIND') {
      headline = `Vas por detrás: faltan ${this.formatCurrency(pending, currency)} y quedan ${daysRemaining} días.`;
      recommendation = `Separa ${this.formatCurrency(dailyRequired, currency)} al día para cubrir alquiler, suministros, autónomos y nóminas antes de fin de mes.`;
    } else {
      headline = `Faltan ${this.formatCurrency(pending, currency)} y quedan ${daysRemaining} días.`;
      recommendation = `Objetivo diario: separar ${this.formatCurrency(dailyRequired, currency)} para llegar a fin de mes con gastos fijos cubiertos.`;
    }

    return {
      totalMonthly: this.roundMoney(totalMonthly),
      covered: this.roundMoney(paid),
      pending: this.roundMoney(pending),
      coveragePct,
      daysInMonth,
      elapsedDays,
      daysRemaining,
      coveredUntilDay,
      dailyRequired,
      monthlyDailyTarget,
      expectedCoveredByToday,
      paceDelta,
      paceStatus,
      headline,
      recommendation
    };
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

  private roundMoney(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private formatCurrency(value: number, currency: string): string {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  }

  private normalize(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private itemCost(item: any): ItemCost {
    const type = (item.productType ?? item.title ?? '').toString().toLowerCase();
    const text = `${item.productType ?? ''} ${item.title ?? ''} ${item.sku ?? ''}`.toString().toLowerCase();
    const color = (item.color ?? item.variantTitle ?? '').toString().toLowerCase();
    const isBanador = /bañad|banad|swim|bikini|bath/.test(type);
    const isSudadera = /sudader/.test(type);
    const isBoxy = /\bboxy\b/.test(text);
    const isCamiseta = !isBanador && (/camiset/.test(type) || !isSudadera);
    const isBlack = /negro|black/.test(color);
    const isWhite = /blanco|white/.test(color);
    const isPink = /rosa|pink/.test(color);

    let blank = 0;
    let print = 0;
    let description = '';
    if (isBanador) {
      blank = 4.725; // 4,725 € + IVA (neto, IVA recuperable)
      print = 2.25 + 0.45; // siempre DTF
      description = 'Bañador (DTF espalda+frontal)';
    } else if (isSudadera) {
      blank = 10.75;
      if (isBlack || isPink) {
        print = 2.25 + 0.45;
        description = isPink ? 'Sudadera Light Pink (DTF espalda+frontal)' : 'Sudadera negra (DTF espalda+frontal)';
      } else {
        print = 0.50;
        description = 'Sudadera blanca (DTG)';
      }
    } else if (isCamiseta) {
      if (isBoxy) {
        blank = 4.90;
        print = 0.50;
        description = 'Camiseta blanca BOXY (DTG)';
      } else if (isBlack) {
        blank = 2.73;
        print = 2.25 + 0.45;
        description = 'Camiseta negra (DTF espalda+frontal)';
      } else if (isWhite) {
        blank = 2.73;
        print = 0.50;
        description = 'Camiseta blanca (DTG)';
      } else {
        blank = 2.73;
        print = 0.50;
        description = 'Camiseta (DTG estimado)';
      }
    } else {
      description = 'Producto sin coste configurado';
    }
    return { blank, print, description };
  }
}
