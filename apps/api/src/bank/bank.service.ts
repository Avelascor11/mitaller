import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BankTransactionCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GoCardlessBankAdapter } from './gocardless-bank.adapter';

@Injectable()
export class BankService {
  private readonly logger = new Logger(BankService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly gocardless: GoCardlessBankAdapter,
    private readonly config: ConfigService
  ) {}

  async status() {
    const [connections, accounts] = await Promise.all([
      this.prisma.bankConnection.count(),
      this.prisma.bankAccount.count()
    ]);
    return {
      provider: 'GOCARDLESS',
      configured: this.gocardless.configured,
      connections,
      accounts
    };
  }

  institutions(country = 'ES') {
    return this.gocardless.institutions(country);
  }

  async connect(input: { institutionId: string; institutionName?: string; redirectUrl?: string }) {
    if (!input.institutionId) throw new BadRequestException('institutionId requerido');
    const reference = `mitaller-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const redirect = input.redirectUrl
      ?? this.config.get<string>('BANK_REDIRECT_URL')
      ?? `${this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3001'}/bank/callback`;
    const requisition = await this.gocardless.createRequisition({
      institutionId: input.institutionId,
      redirect,
      reference
    }) as any;

    const connection = await this.prisma.bankConnection.create({
      data: {
        institutionId: input.institutionId,
        institutionName: input.institutionName,
        requisitionId: requisition.id,
        reference,
        link: requisition.link,
        status: 'PENDING',
        rawDataJson: requisition
      }
    });

    return { ...connection, link: requisition.link };
  }

  async callback(reference?: string, requisitionId?: string, code?: string) {
    const connection = await this.findConnection(reference, requisitionId);
    return this.refreshConnection(connection.id, code);
  }

  async refreshConnection(id: string, code?: string) {
    const connection = await this.prisma.bankConnection.findUnique({ where: { id } });
    if (!connection) throw new NotFoundException('Conexion bancaria no encontrada');
    const requisition = await this.gocardless.requisition(connection.requisitionId);
    const accounts = Array.isArray(requisition.accounts) ? requisition.accounts : [];

    const updated = await this.prisma.bankConnection.update({
      where: { id: connection.id },
      data: {
        status: accounts.length ? 'LINKED' : 'PENDING',
        connectedAt: accounts.length ? new Date() : connection.connectedAt,
        accountsJson: accounts,
        rawDataJson: requisition
      }
    });

    for (const providerAccountId of accounts) {
      const details = await this.gocardless.accountDetails(providerAccountId);
      const account: any = details.account ?? details;
      await this.prisma.bankAccount.upsert({
        where: { providerAccountId },
        create: {
          connectionId: connection.id,
          providerAccountId,
          iban: account.iban,
          name: account.name ?? account.displayName,
          currency: account.currency,
          ownerName: account.ownerName,
          product: account.product,
          cashAccountType: account.cashAccountType,
          rawDataJson: details
        },
        update: {
          iban: account.iban,
          name: account.name ?? account.displayName,
          currency: account.currency,
          ownerName: account.ownerName,
          product: account.product,
          cashAccountType: account.cashAccountType,
          rawDataJson: details
        }
      });
    }

    return updated;
  }

  async sync(from?: string, to?: string) {
    const accounts = await this.prisma.bankAccount.findMany({ include: { connection: true } });
    let imported = 0;
    for (const account of accounts) {
      const response = await this.gocardless.accountTransactions(account.providerAccountId, from, to);
      const transactions = [
        ...(response.transactions?.booked ?? []),
        ...(response.transactions?.pending ?? [])
      ];
      for (const transaction of transactions) {
        await this.upsertTransaction(account.id, transaction);
        imported += 1;
      }
      // Fetch + persist balance here (scheduled), to avoid GoCardless rate limits on /accounts.
      try {
        const balResponse = await this.accountBalancesWithRetry(account.providerAccountId);
        const balances = balResponse.balances ?? [];
        this.logger.log(`Balances ${account.name}: ${JSON.stringify(balances)}`);
        const currentBalance = this.pickBalance(balances, ['interimBooked', 'closingBooked', 'expected', 'openingBooked', 'interimAvailable']);
        const availableBalance = this.pickBalance(balances, ['interimAvailable', 'forwardAvailable', 'nonInvoiced', 'expected']);
        if (currentBalance != null || availableBalance != null) {
          await this.prisma.bankAccount.update({
            where: { id: account.id },
            data: { currentBalance, availableBalance, balanceUpdatedAt: new Date() }
          });
        }
      } catch (e) {
        this.logger.warn(`Balance fetch failed ${account.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await this.prisma.bankConnection.update({
        where: { id: account.connectionId },
        data: { lastSyncedAt: new Date() }
      });
    }
    return { imported, accounts: accounts.length };
  }

  async transactions(from?: string, to?: string) {
    const range = this.dateRange(from, to);
    return this.prisma.bankTransaction.findMany({
      where: { bookingDate: { gte: range.start, lte: range.end } },
      include: { account: true },
      orderBy: { bookingDate: 'desc' }
    });
  }

  async accounts() {
    const accounts = await this.prisma.bankAccount.findMany({
      include: { connection: true },
      orderBy: { createdAt: 'desc' }
    });
    const enriched = accounts.map(account => ({
      id: account.id,
      providerAccountId: account.providerAccountId,
      institutionName: account.connection.institutionName,
      iban: this.maskIban(account.iban),
      name: account.name ?? account.connection.institutionName ?? 'Cuenta bancaria',
      currency: account.currency ?? 'EUR',
      ownerName: account.ownerName,
      product: account.product,
      currentBalance: account.currentBalance ?? null,
      availableBalance: account.availableBalance ?? null,
      balanceUpdatedAt: account.balanceUpdatedAt ?? null,
      connectedAt: account.connection.connectedAt,
      lastSyncedAt: account.connection.lastSyncedAt
    }));

    const balanceAvailable = enriched.some(account => account.currentBalance != null);
    const totalBalance = enriched.reduce((sum, account) => sum + (account.currentBalance ?? 0), 0);
    return {
      currency: enriched[0]?.currency ?? 'EUR',
      totalBalance,
      balanceAvailable,
      accounts: enriched
    };
  }

  async allocation() {
    const shopifyFeeRate = 0.024;
    const taxRate = this.taxReserveRate();
    const productionRate = this.productionRate();
    const shippingRate = this.shippingRate();
    const cashFreeRate = 1 - taxRate - productionRate - shippingRate;

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const payouts = await this.prisma.bankTransaction.findMany({
      where: {
        category: 'SHOPIFY_PAYOUT',
        amount: { gt: 0 },
        bookingDate: { gte: since }
      },
      orderBy: { bookingDate: 'desc' },
      take: 20
    });

    const allocate = (amount: number) => {
      const gross = amount / (1 - shopifyFeeRate);
      const taxReserve = gross * taxRate;
      const production = gross * productionRate;
      const shipping = gross * shippingRate;
      const cashFree = amount - taxReserve - production - shipping;
      return { taxReserve, production, shipping, cashFree };
    };

    return {
      currency: 'EUR',
      rates: { taxReserve: taxRate, production: productionRate, shipping: shippingRate, cashFree: cashFreeRate },
      payouts: payouts.map(tx => ({
        id: tx.id,
        date: tx.bookingDate.toISOString().slice(0, 10),
        description: tx.description,
        totalAmount: tx.amount,
        allocation: allocate(tx.amount)
      }))
    };
  }

  async daily(from?: string, to?: string) {
    const transactions = await this.transactions(from, to);
    const totals = transactions.reduce(
      (acc, tx) => {
        if (tx.amount >= 0) acc.income += tx.amount;
        else acc.expense += Math.abs(tx.amount);
        acc.net += tx.amount;
        acc.count += 1;
        acc.byCategory[tx.category] = (acc.byCategory[tx.category] ?? 0) + tx.amount;
        return acc;
      },
      { income: 0, expense: 0, net: 0, count: 0, byCategory: {} as Record<string, number> }
    );
    return {
      currency: transactions[0]?.currency ?? 'EUR',
      ...totals,
      transactions
    };
  }

  async adviseExpense(input: { amount: number; concept?: string; date?: string }) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Importe requerido y debe ser mayor que 0');
    }

    const accounts = await this.accounts();
    const currentBalance = accounts.totalBalance;
    const balanceAvailable = Boolean((accounts as any).balanceAvailable);
    const safetyBuffer = this.cashSafetyBuffer();
    const projectedBalance = currentBalance - amount;
    const freeAfterBuffer = projectedBalance - safetyBuffer;
    const today = input.date ?? new Date().toISOString().slice(0, 10);
    const recent = await this.recentCashStats(30);
    const shortRecent = await this.recentCashStats(14);
    const isWeekend = this.isWeekend(today);

    let verdict: 'APPROVED' | 'WATCH' | 'REJECTED' = 'APPROVED';
    const reasons: string[] = [];

    if (!accounts.accounts.length) {
      verdict = 'REJECTED';
      reasons.push('No hay ninguna cuenta bancaria conectada todavia.');
    }
    if (accounts.accounts.length && !balanceAvailable) {
      verdict = 'REJECTED';
      reasons.push('No he podido leer el saldo real de N26 ahora mismo. Sin saldo fiable no apruebo gastos.');
    }
    if (balanceAvailable && projectedBalance < safetyBuffer) {
      verdict = 'REJECTED';
      reasons.push(`Despues del gasto quedarias por debajo del colchon minimo de ${this.money(safetyBuffer, accounts.currency)}.`);
    } else if (balanceAvailable && (freeAfterBuffer < amount * 0.75 || shortRecent.net < 0)) {
      verdict = verdict === 'REJECTED' ? verdict : 'WATCH';
      reasons.push('Se puede hacer, pero deja poco margen respecto al ritmo reciente de caja.');
    }
    if (isWeekend) {
      if (verdict === 'APPROVED') verdict = 'WATCH';
      reasons.push('Es fin de semana: Shopify suele pagar mas tarde, asi que conviene ser conservador.');
    }
    if (recent.expense > recent.income && verdict !== 'REJECTED') {
      verdict = 'WATCH';
      reasons.push('En los ultimos 30 dias ha salido mas caja de la que ha entrado.');
    }
    if (!reasons.length) {
      reasons.push('La caja queda por encima del colchon y el gasto encaja con el flujo reciente.');
    }

    return {
      currency: accounts.currency,
      concept: input.concept?.trim() || 'Gasto propuesto',
      amount,
      verdict,
      headline: this.expenseHeadline(verdict, input.concept, amount, accounts.currency),
      recommendation: this.expenseRecommendation(verdict, freeAfterBuffer, accounts.currency),
      currentBalance,
      projectedBalance,
      safetyBuffer,
      freeAfterBuffer,
      balanceAvailable,
      recent30Days: recent,
      recent14Days: shortRecent,
      isWeekend,
      reasons
    };
  }

  private async upsertTransaction(accountId: string, transaction: any) {
    const amount = Number(transaction.transactionAmount?.amount ?? 0);
    const description = [
      transaction.remittanceInformationUnstructured,
      transaction.remittanceInformationUnstructuredArray?.join(' '),
      transaction.additionalInformation,
      transaction.creditorName,
      transaction.debtorName
    ].filter(Boolean).join(' ').trim() || 'Movimiento bancario';
    const providerTransactionId = transaction.transactionId
      ?? transaction.internalTransactionId
      ?? `${transaction.bookingDate}-${amount}-${description}`.slice(0, 180);

    await this.prisma.bankTransaction.upsert({
      where: { accountId_providerTransactionId: { accountId, providerTransactionId } },
      create: {
        accountId,
        providerTransactionId,
        bookingDate: new Date(`${transaction.bookingDate ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        valueDate: transaction.valueDate ? new Date(`${transaction.valueDate}T00:00:00.000Z`) : undefined,
        amount,
        currency: transaction.transactionAmount?.currency ?? 'EUR',
        description,
        merchantName: transaction.merchantName,
        remittanceInfo: transaction.remittanceInformationUnstructured,
        counterpartyName: transaction.creditorName ?? transaction.debtorName,
        counterpartyIban: transaction.creditorAccount?.iban ?? transaction.debtorAccount?.iban,
        category: this.categorize(description, amount),
        orderNumber: this.extractOrderNumber(description),
        rawDataJson: transaction
      },
      update: {
        amount,
        description,
        merchantName: transaction.merchantName,
        remittanceInfo: transaction.remittanceInformationUnstructured,
        counterpartyName: transaction.creditorName ?? transaction.debtorName,
        counterpartyIban: transaction.creditorAccount?.iban ?? transaction.debtorAccount?.iban,
        category: this.categorize(description, amount),
        orderNumber: this.extractOrderNumber(description),
        rawDataJson: transaction
      }
    });
  }

  private pickBalance(balances: any[], preferredTypes: string[]): number | null {
    for (const type of preferredTypes) {
      const match = balances.find(balance => balance.balanceType === type);
      const amount = Number(match?.balanceAmount?.amount);
      if (Number.isFinite(amount)) return amount;
    }
    const fallback = Number(balances[0]?.balanceAmount?.amount);
    return Number.isFinite(fallback) ? fallback : null;
  }

  private async accountBalancesWithRetry(accountId: string) {
    try {
      return await this.gocardless.accountBalances(accountId);
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return this.gocardless.accountBalances(accountId);
    }
  }

  private async recentCashStats(days: number) {
    const end = new Date();
    const start = new Date(end.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    const transactions = await this.prisma.bankTransaction.findMany({
      where: { bookingDate: { gte: start, lte: end } }
    });
    const totals = transactions.reduce(
      (acc, tx) => {
        if (tx.amount >= 0) acc.income += tx.amount;
        else acc.expense += Math.abs(tx.amount);
        acc.net += tx.amount;
        acc.count += 1;
        return acc;
      },
      { days, income: 0, expense: 0, net: 0, count: 0, averageDailyNet: 0 }
    );
    totals.averageDailyNet = totals.net / days;
    return totals;
  }

  private cashSafetyBuffer(): number {
    const raw = this.config.get<string>('CASH_SAFETY_BUFFER_EUR');
    const parsed = Number(raw?.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 500;
  }

  private isWeekend(date: string): boolean {
    const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
  }

  private expenseHeadline(verdict: 'APPROVED' | 'WATCH' | 'REJECTED', concept: string | undefined, amount: number, currency: string) {
    const label = concept?.trim() || 'ese gasto';
    if (verdict === 'APPROVED') return `Si, puedes hacer ${label} por ${this.money(amount, currency)}.`;
    if (verdict === 'WATCH') return `Puedes hacer ${label}, pero con cuidado.`;
    return `Mejor no hacer ${label} ahora mismo.`;
  }

  private expenseRecommendation(verdict: 'APPROVED' | 'WATCH' | 'REJECTED', freeAfterBuffer: number, currency: string) {
    if (verdict === 'APPROVED') return `Despues del gasto aun quedarian ${this.money(Math.max(0, freeAfterBuffer), currency)} por encima del colchon.`;
    if (verdict === 'WATCH') return 'Yo lo haria solo si es necesario para vender o producir pedidos pendientes.';
    return 'Espera a que entre caja, baja el importe o revisa gastos pendientes antes de comprar.';
  }

  private money(value: number, currency: string) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  }

  private maskIban(iban?: string | null) {
    if (!iban) return null;
    const compact = iban.replace(/\s/g, '');
    if (compact.length <= 8) return compact;
    return `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
  }

  private categorize(description: string, amount: number): BankTransactionCategory {
    const text = description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/shopify|stripe/.test(text)) return BankTransactionCategory.SHOPIFY_PAYOUT;
    if (/sendcloud|correos|paq/.test(text)) return BankTransactionCategory.SENDCLOUD;
    if (/falk|ross|textil|camiseta|sudadera|roly|b\s*&\s*c/.test(text)) return BankTransactionCategory.GARMENT_SUPPLIER;
    if (/dtf|transfer|vinilo/.test(text)) return BankTransactionCategory.DTF_SUPPLIER;
    if (/hacienda|aeat|iva|impuesto|seguridad social/.test(text)) return BankTransactionCategory.TAX;
    if (/meta|facebook|instagram|google ads|tiktok/.test(text)) return BankTransactionCategory.ADS;
    if (/apple|openai|railway|github|software|canva|adobe/.test(text)) return BankTransactionCategory.SOFTWARE;
    return amount >= 0 ? BankTransactionCategory.OTHER_INCOME : BankTransactionCategory.OTHER_EXPENSE;
  }

  private extractOrderNumber(description: string) {
    return description.match(/#?9\d{3,}/)?.[0]?.replace(/^/, '#').replace('##', '#');
  }

  private async findConnection(reference?: string, requisitionId?: string) {
    const connection = await this.prisma.bankConnection.findFirst({
      where: {
        OR: [
          reference ? { reference } : undefined,
          requisitionId ? { requisitionId } : undefined
        ].filter(Boolean) as any[]
      }
    });
    if (!connection) throw new NotFoundException('Conexion bancaria no encontrada');
    return connection;
  }

  private taxReserveRate(): number {
    const raw = this.config.get<string>('ECONOMICS_TAX_RESERVE_RATE');
    const parsed = Number(raw?.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.15;
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

  private dateRange(from?: string, to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const startStr = from ?? today;
    const endStr = to ?? startStr;
    return {
      start: new Date(`${startStr}T00:00:00.000Z`),
      end: new Date(`${endStr}T23:59:59.999Z`)
    };
  }
}
