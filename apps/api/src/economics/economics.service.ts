import { BadRequestException, Injectable } from '@nestjs/common';
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

type EconomicsOverviewPeriod = 'day' | 'week' | 'month' | 'custom';

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

  async overview(period = 'month', from?: string, to?: string) {
    const range = this.overviewRange(period, from, to);
    const previousRange = this.previousRange(range.start, range.end);

    const [current, previous, bankTransactions, fixedExpenses] = await Promise.all([
      this.summary(range.start, range.end),
      this.summary(previousRange.start, previousRange.end),
      this.prisma.bankTransaction.findMany({
        where: { bookingDate: { gte: range.start, lte: range.end } },
        orderBy: { amount: 'asc' },
        take: 500
      }),
      this.fixedExpenses(this.fixedExpensePeriodForDate(range.end)).catch(() => null)
    ]);

    const currency = current.currency ?? bankTransactions[0]?.currency ?? 'EUR';
    const bank = this.bankOverview(bankTransactions, currency);
    const comparison = {
      revenueDelta: this.round(current.grossRevenue - previous.grossRevenue),
      revenueDeltaPct: this.percentChange(current.grossRevenue, previous.grossRevenue),
      ordersDelta: current.orderCount - previous.orderCount,
      marginDelta: this.round(current.netMargin - previous.netMargin),
      marginDeltaPct: this.percentChange(current.netMargin, previous.netMargin),
      expenseDelta: this.round(bank.expense - await this.bankExpenseTotal(previousRange.start, previousRange.end)),
    };
    const status = this.overviewStatus(current, bank.expense, comparison.revenueDeltaPct);
    const recommendations = this.overviewRecommendations({
      current,
      previous,
      bank,
      fixedPending: Number((fixedExpenses as any)?.pending ?? 0),
      comparison,
      currency
    });

    return {
      period: range.period,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      label: range.label,
      currency,
      status,
      headline: this.overviewHeadline(status, range.label, current, comparison, currency),
      current: this.summarySnapshot(current),
      previous: this.summarySnapshot(previous),
      comparison,
      bank,
      fixedExpenses: fixedExpenses ? {
        totalMonthly: Number((fixedExpenses as any).totalMonthly ?? 0),
        paid: Number((fixedExpenses as any).paid ?? 0),
        pending: Number((fixedExpenses as any).pending ?? 0)
      } : null,
      recommendations
    };
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

  private overviewRange(period: string, from?: string, to?: string): { period: EconomicsOverviewPeriod; start: Date; end: Date; label: string } {
    const normalized = (period ?? 'month').toLowerCase();
    const now = new Date();

    if (normalized === 'custom') {
      const start = from ? new Date(`${from}T00:00:00.000`) : new Date(now);
      const end = to ? new Date(`${to}T23:59:59.999`) : new Date(start);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException('Rango de fechas invalido');
      return { period: 'custom', start, end, label: `${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}` };
    }

    if (normalized === 'day' || normalized === 'today') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      return { period: 'day', start, end, label: 'hoy' };
    }

    if (normalized === 'week') {
      const start = new Date(now);
      const day = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { period: 'week', start, end, label: 'esta semana' };
    }

    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { period: 'month', start, end, label: 'este mes' };
  }

  private previousRange(start: Date, end: Date) {
    const duration = end.getTime() - start.getTime() + 1;
    const previousEnd = new Date(start.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - duration + 1);
    return { start: previousStart, end: previousEnd };
  }

  private summarySnapshot(summary: any) {
    return {
      grossRevenue: this.round(summary.grossRevenue),
      netMargin: this.round(summary.netMargin),
      cashFree: this.round(summary.cashFree),
      cashFreePct: summary.cashFreePct == null ? null : this.round(summary.cashFreePct),
      adSpend: this.round(summary.adSpend ?? 0),
      orderCount: summary.orderCount,
      averageOrderValue: summary.orderCount > 0 ? this.round(summary.grossRevenue / summary.orderCount) : 0,
      productCost: this.round(summary.productCost),
      shippingCost: this.round(summary.shippingCost),
      taxReserve: this.round(summary.taxReserve)
    };
  }

  private bankOverview(transactions: any[], currency: string) {
    const totals = transactions.reduce(
      (acc, tx) => {
        const amount = Number(tx.amount ?? 0);
        if (amount >= 0) acc.income += amount;
        else acc.expense += Math.abs(amount);
        acc.net += amount;
        return acc;
      },
      { income: 0, expense: 0, net: 0 }
    );

    const byCategory = new Map<string, { category: string; label: string; amount: number; income: number; expense: number; count: number }>();
    for (const tx of transactions) {
      const amount = Number(tx.amount ?? 0);
      const category = String(tx.category ?? 'OTHER_EXPENSE');
      const current = byCategory.get(category) ?? {
        category,
        label: this.bankCategoryLabel(category),
        amount: 0,
        income: 0,
        expense: 0,
        count: 0
      };
      current.amount += amount;
      if (amount >= 0) current.income += amount;
      else current.expense += Math.abs(amount);
      current.count += 1;
      byCategory.set(category, current);
    }

    const categories = [...byCategory.values()]
      .map((row) => ({
        ...row,
        amount: this.round(row.amount),
        income: this.round(row.income),
        expense: this.round(row.expense),
        sharePct: totals.expense > 0 ? this.round((row.expense / totals.expense) * 100) : 0
      }))
      .sort((a, b) => b.expense - a.expense);

    const biggestExpense = categories.find((category) => category.expense > 0) ?? null;

    return {
      currency,
      income: this.round(totals.income),
      expense: this.round(totals.expense),
      net: this.round(totals.net),
      transactions: transactions.length,
      biggestExpense,
      categories: categories.slice(0, 8),
      recentExpenses: transactions
        .filter((tx) => Number(tx.amount ?? 0) < 0)
        .slice(0, 8)
        .map((tx) => ({
          id: tx.id,
          date: tx.bookingDate?.toISOString?.() ?? tx.bookingDate,
          amount: this.round(Math.abs(Number(tx.amount ?? 0))),
          description: tx.description,
          category: String(tx.category ?? 'OTHER_EXPENSE'),
          label: this.bankCategoryLabel(String(tx.category ?? 'OTHER_EXPENSE'))
        }))
    };
  }

  private async bankExpenseTotal(start: Date, end: Date) {
    const result = await this.prisma.bankTransaction.aggregate({
      where: { bookingDate: { gte: start, lte: end }, amount: { lt: 0 } },
      _sum: { amount: true }
    });
    return Math.abs(Number(result._sum.amount ?? 0));
  }

  private overviewStatus(current: any, bankExpense: number, revenueDeltaPct: number | null): 'GOOD' | 'WATCH' | 'BAD' {
    if (current.grossRevenue <= 0 && bankExpense > 0) return 'BAD';
    if (current.netMargin < 0 || current.cashFree < 0) return 'BAD';
    if ((revenueDeltaPct ?? 0) < -20 || (current.cashFreePct ?? 0) < 15) return 'WATCH';
    return 'GOOD';
  }

  private overviewHeadline(status: 'GOOD' | 'WATCH' | 'BAD', label: string, current: any, comparison: any, currency: string) {
    if (status === 'BAD') return `Cuidado: ${label} no está dejando caja libre suficiente.`;
    if (status === 'WATCH') return `${label} va justo: margen ${this.formatMoney(current.netMargin, currency)} y ventas ${this.deltaPctText(comparison.revenueDeltaPct)}.`;
    return `${label} va sano: margen estimado ${this.formatMoney(current.netMargin, currency)} y ${current.orderCount} pedidos.`;
  }

  private overviewRecommendations(input: {
    current: any;
    previous: any;
    bank: any;
    fixedPending: number;
    comparison: any;
    currency: string;
  }) {
    const recommendations: Array<{ title: string; detail: string; priority: 'HIGH' | 'MEDIUM' | 'LOW'; kind: string; icon: string }> = [];
    const { current, previous, bank, fixedPending, comparison, currency } = input;
    const biggest = bank.biggestExpense;

    if (current.netMargin < 0) {
      recommendations.push({
        title: 'Frena gasto variable',
        detail: `El margen despues de ads está en ${this.formatMoney(current.netMargin, currency)}. Revisa ads, compras no urgentes y descuentos antes de meter más gasto.`,
        priority: 'HIGH',
        kind: 'PROTECT_MARGIN',
        icon: 'shield.fill'
      });
    }

    if ((comparison.revenueDeltaPct ?? 0) < -20) {
      recommendations.push({
        title: 'Ventas por debajo del periodo anterior',
        detail: `La facturación baja ${Math.abs(comparison.revenueDeltaPct).toFixed(0)}%. Mira campañas activas, stock bloqueado y productos con mejor margen.`,
        priority: 'HIGH',
        kind: 'RECOVER_SALES',
        icon: 'chart.line.downtrend.xyaxis'
      });
    }

    if (biggest && biggest.expense > 0) {
      const priority = biggest.sharePct >= 45 ? 'HIGH' : 'MEDIUM';
      recommendations.push({
        title: `Mayor gasto: ${biggest.label}`,
        detail: `${biggest.label} se lleva ${this.formatMoney(biggest.expense, currency)} (${biggest.sharePct.toFixed(0)}% del gasto bancario del periodo).`,
        priority,
        kind: 'TOP_EXPENSE',
        icon: 'chart.pie.fill'
      });
    }

    if ((current.adSpend ?? 0) > 0 && current.grossRevenue > 0) {
      const adsShare = (current.adSpend / current.grossRevenue) * 100;
      if (adsShare > 30) {
        recommendations.push({
          title: 'Ads demasiado pesados',
          detail: `Meta pesa un ${adsShare.toFixed(0)}% de las ventas del periodo. Sube solo campañas con ROAS claro y pausa las que no venden.`,
          priority: 'HIGH',
          kind: 'ADS_CONTROL',
          icon: 'megaphone.fill'
        });
      }
    }

    if (fixedPending > 0) {
      recommendations.push({
        title: 'Reserva gastos fijos',
        detail: `Quedan ${this.formatMoney(fixedPending, currency)} pendientes de gastos fijos. Sepáralos antes de hablar de beneficio real.`,
        priority: 'HIGH',
        kind: 'FIXED_EXPENSES',
        icon: 'building.columns.fill'
      });
    }

    if (current.orderCount > previous.orderCount && current.netMargin > previous.netMargin) {
      recommendations.push({
        title: 'Buen momento para repetir lo que funciona',
        detail: 'Suben pedidos y margen contra el periodo anterior. Revisa los productos/campañas ganadores y escala con límite diario.',
        priority: 'LOW',
        kind: 'SCALE_WINNERS',
        icon: 'bolt.fill'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        title: 'Mantener y observar',
        detail: 'No veo una alarma clara. Mantén compras obligatorias, controla ads a diario y revisa caja antes de gastos nuevos.',
        priority: 'LOW',
        kind: 'HOLD',
        icon: 'checkmark.seal.fill'
      });
    }

    return recommendations.slice(0, 5);
  }

  private bankCategoryLabel(category: string) {
    const labels: Record<string, string> = {
      SHOPIFY_PAYOUT: 'Cobros Shopify',
      SENDCLOUD: 'Envíos',
      GARMENT_SUPPLIER: 'Ropa/proveedor',
      DTF_SUPPLIER: 'DTF',
      TAX: 'Impuestos',
      ADS: 'Ads',
      SOFTWARE: 'Software',
      OTHER_INCOME: 'Otros ingresos',
      OTHER_EXPENSE: 'Otros gastos'
    };
    return labels[category] ?? category.replaceAll('_', ' ').toLowerCase();
  }

  private fixedExpensePeriodForDate(date: Date) {
    return date.toISOString().slice(0, 7);
  }

  private percentChange(current: number, previous: number) {
    if (!Number.isFinite(previous) || Math.abs(previous) < 0.01) return current > 0 ? 100 : null;
    return this.round(((current - previous) / Math.abs(previous)) * 100);
  }

  private deltaPctText(value: number | null) {
    if (value == null) return 'sin comparativa';
    return `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`;
  }

  private round(value: number) {
    return Math.round((Number(value) || 0) * 100) / 100;
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

  async fixedExpenses(period?: string) {
    const currentPeriod = this.fixedExpensePeriod(period);
    const expenses = await this.prisma.fixedExpense.findMany({
      include: { payments: { where: { period: currentPeriod } } },
      orderBy: [{ active: 'desc' }, { dueDay: 'asc' }, { name: 'asc' }]
    });
    const items = expenses.map((expense) => {
      const payment = expense.payments[0] ?? null;
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
        paid: Boolean(payment),
        paidAt: payment?.paidAt ?? null,
        paidAmount: payment?.amount ?? null,
        paymentId: payment?.id ?? null,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt
      };
    });
    const active = items.filter((item) => item.active);
    const totalMonthly = +active.reduce((sum, item) => sum + item.amount, 0).toFixed(2);
    const paid = +active.filter((item) => item.paid).reduce((sum, item) => sum + (item.paidAmount ?? item.amount), 0).toFixed(2);
    const pending = +Math.max(0, totalMonthly - paid).toFixed(2);
    const upcoming = active
      .filter((item) => !item.paid)
      .sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99))
      .slice(0, 5);

    return {
      period: currentPeriod,
      currency: active[0]?.currency ?? items[0]?.currency ?? 'EUR',
      totalMonthly,
      paid,
      pending,
      activeCount: active.length,
      paidCount: active.filter((item) => item.paid).length,
      items,
      upcoming,
      templates: this.fixedExpenseTemplates()
    };
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
    return 721;
  }

  private retroAstonMilestones() {
    return [1, 2, 3].map((milestone) => ({
      milestone,
      label: `Pago ${milestone}/3`,
      amount: this.retroAstonInstallmentAmount(),
      dueAt: null as Date | null
    }));
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
      { name: 'Gestoría', category: 'GESTORIA', icon: 'folder.fill' },
      { name: 'Software', category: 'SOFTWARE', icon: 'desktopcomputer' },
      { name: 'Seguro', category: 'SEGUROS', icon: 'shield.fill' }
    ];
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
