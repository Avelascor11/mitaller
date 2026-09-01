import { describe, expect, it } from 'vitest';
import { EconomicsService } from '../src/economics/economics.service';

function service(config: Record<string, string> = {}) {
  return new EconomicsService(
    {} as never,
    { get: (key: string) => config[key] } as never,
    {} as never,
    { spendForRange: async () => 0 } as never,
    {
      accounts: async () => ({ currency: 'EUR', totalBalance: 0, balanceAvailable: false, accounts: [] }),
      syncIfStale: async () => ({ skipped: true }),
      transactions: async () => []
    } as never,
    { getPurchaseMatrix: async () => ({ groups: [] }) } as never
  ) as unknown as {
    computeOrderBreakdown: (order: unknown) => {
      shippingRevenue: number;
      shippingCost: number;
      shippingReserve?: number;
      shippingCostSource: string;
      shipmentCostKnown: boolean;
      productCost: number;
      wasteCost: number;
      taxReserve: number;
      cashFree: number;
      netMargin: number;
    };
    isSavingsBankAccount: (account: { name?: string | null; product?: string | null; cashAccountType?: string | null }) => boolean;
  };
}

function fixedExpenseService(expenses: unknown[], transactions: unknown[] = []) {
  return new EconomicsService(
    { fixedExpense: { findMany: async () => expenses } } as never,
    { get: () => undefined } as never,
    {} as never,
    { spendForRange: async () => 0 } as never,
    {
      accounts: async () => ({ currency: 'EUR', totalBalance: 0, balanceAvailable: false, accounts: [] }),
      syncIfStale: async () => ({ skipped: true }),
      transactions: async () => transactions
    } as never,
    { getPurchaseMatrix: async () => ({ groups: [] }) } as never
  ) as unknown as {
    fixedExpenses: (period?: string) => Promise<{
      period: string;
      totalMonthly: number;
      paid: number;
      pending: number;
      activeCount: number;
      autoReconciledCount: number;
      rejectedCount: number;
      items: Array<{
        name: string;
        paid: boolean;
        paidAmount: number | null;
        paymentSource: string | null;
        reconciliationStatus: string;
      }>;
      upcoming: Array<{ name: string }>;
    }>;
  };
}

describe('EconomicsService', () => {
  it('reparte el cobro de caja una sola vez y suma exactamente el importe recibido', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const economics = new EconomicsService(
      {
        payoutMark: { findMany: async () => [] },
        order: { findMany: async () => [] }
      } as never,
      { get: () => undefined } as never,
      {
        listPayouts: async () => [{ id: 'payout-1', status: 'paid', date: today, amount: 100, currency: 'EUR' }],
        listPayoutTransactions: async () => [{
          type: 'charge',
          amount: 100,
          fee: -2.4,
          processed_at: `${today}T09:00:00Z`,
          source_order_id: null
        }]
      } as never,
      { spendForRange: async () => 0 } as never,
      {} as never,
      {} as never
    );

    const result = await economics.cashflow();
    const allocation = result.allocation;
    const recoveryTotal = (allocation.variableReserve ?? 0)
      + (allocation.debtReserve ?? 0)
      + (allocation.savingsReserve ?? 0)
      + (allocation.fixedReserve ?? 0)
      + (allocation.operationsReserve ?? 0);

    expect(result.receivedToday).toBe(100);
    expect(allocation.variableReserve).toBe(46.8);
    expect(allocation.debtReserve).toBe(20);
    expect(allocation.savingsReserve).toBe(18.57);
    expect(allocation.fixedReserve).toBe(9.63);
    expect(allocation.operationsReserve).toBe(5);
    expect(recoveryTotal).toBe(100);
    expect(allocation.taxReserve + allocation.production + allocation.shipping + allocation.adsReserve + allocation.cashFree).toBe(0);
  });

  it('solo trata como ahorro las cuentas identificadas para ese fin', () => {
    const economics = service();

    expect(economics.isSavingsBankAccount({ name: 'Ahorro 15K' })).toBe(true);
    expect(economics.isSavingsBankAccount({ name: 'N26 Main Account', product: 'Current Account' })).toBe(false);
    expect(economics.isSavingsBankAccount({ name: 'Reserva impuestos' })).toBe(false);
  });

  it('imputa coste de envio aunque el cliente tenga envio gratis', () => {
    const breakdown = service().computeOrderBreakdown({
      id: 'order-1',
      orderNumber: '#9490',
      customerName: 'Cliente',
      orderedAt: new Date('2026-05-06T10:00:00Z'),
      currency: 'EUR',
      shippingMethod: 'Correos Estandar Entrega a Domicilio 0-1kg',
      shippingCountry: 'ES',
      subtotalPrice: 55,
      totalShipping: 0,
      totalDiscount: 0,
      totalPrice: 55,
      shipments: [],
      items: [
        {
          id: 'item-1',
          sku: 'TEE-WHITE-M',
          title: 'Camiseta test',
          productType: 'Camiseta',
          color: 'Blanca',
          size: 'M',
          quantity: 1,
          unitPrice: 55
        }
      ]
    });

    expect(breakdown.shippingRevenue).toBe(0);
    expect(breakdown.shippingCost).toBe(3.81);
    expect(breakdown.shippingCostSource).toBe('INVOICE_ESTIMATE');
    expect(breakdown.shipmentCostKnown).toBe(false);
    expect(breakdown.productCost).toBe(3.20);
    expect(breakdown.wasteCost).toBeCloseTo(0.064);
    expect(breakdown.taxReserve).toBe(8.25);
    expect(breakdown.cashFree).toBeCloseTo(38.356);
  });

  it('usa el coste real de Sendcloud si la etiqueta lo trae', () => {
    const breakdown = service().computeOrderBreakdown({
      id: 'order-1',
      orderNumber: '#9490',
      customerName: 'Cliente',
      orderedAt: new Date('2026-05-06T10:00:00Z'),
      currency: 'EUR',
      shippingMethod: 'Correos Estandar',
      shippingCountry: 'ES',
      subtotalPrice: 20,
      totalShipping: 0,
      totalDiscount: 0,
      totalPrice: 20,
      shipments: [{ cost: 4.12 }],
      items: []
    });

    expect(breakdown.shippingCost).toBe(4.12);
    expect(breakdown.shippingCostSource).toBe('SENDCLOUD');
    expect(breakdown.shipmentCostKnown).toBe(true);
  });

  it('permite sobrescribir costes estimados por variables de entorno', () => {
    const breakdown = service({ ECONOMICS_SHIPPING_COST_PREMIUM_ES: '4,99' }).computeOrderBreakdown({
      id: 'order-1',
      orderNumber: '#9491',
      customerName: 'Cliente',
      orderedAt: new Date('2026-05-06T10:00:00Z'),
      currency: 'EUR',
      shippingMethod: 'Nacional 24h Correos Premium',
      shippingCountry: 'ES',
      subtotalPrice: 20,
      totalShipping: 0,
      totalDiscount: 0,
      totalPrice: 20,
      shipments: [],
      items: []
    });

    expect(breakdown.shippingCost).toBe(4.99);
  });

  it('permite ajustar la merma por variable de entorno', () => {
    const breakdown = service({ ECONOMICS_WASTE_RATE: '0,05' }).computeOrderBreakdown({
      id: 'order-1',
      orderNumber: '#9492',
      customerName: 'Cliente',
      orderedAt: new Date('2026-05-06T10:00:00Z'),
      currency: 'EUR',
      shippingMethod: 'Correos Estandar',
      shippingCountry: 'ES',
      subtotalPrice: 20,
      totalShipping: 0,
      totalDiscount: 0,
      totalPrice: 20,
      shipments: [],
      items: [
        {
          id: 'item-1',
          sku: 'TEE-WHITE-M',
          title: 'Camiseta test',
          productType: 'Camiseta',
          color: 'Blanca',
          size: 'M',
          quantity: 1,
          unitPrice: 20
        }
      ]
    });

    expect(breakdown.wasteCost).toBeCloseTo(0.1615);
  });

  it('permite ajustar la reserva fiscal por variable de entorno', () => {
    const breakdown = service({ ECONOMICS_TAX_RESERVE_RATE: '0,21' }).computeOrderBreakdown({
      id: 'order-1',
      orderNumber: '#9493',
      customerName: 'Cliente',
      orderedAt: new Date('2026-05-06T10:00:00Z'),
      currency: 'EUR',
      shippingMethod: 'Correos Estandar',
      shippingCountry: 'ES',
      subtotalPrice: 100,
      totalShipping: 0,
      totalDiscount: 0,
      totalPrice: 100,
      shipments: [],
      items: []
    });

    expect(breakdown.taxReserve).toBe(21);
    expect(breakdown.cashFree).toBeCloseTo(72.79);
  });

  it('calcula la sudadera Light Pink con el nuevo coste y DTF', () => {
    const breakdown = service().computeOrderBreakdown({
      id: 'order-pink',
      orderNumber: '#PINK',
      customerName: 'Cliente',
      orderedAt: new Date('2026-08-30T10:00:00Z'),
      currency: 'EUR',
      shippingMethod: 'Correos Estandar',
      shippingCountry: 'ES',
      subtotalPrice: 49.95,
      totalShipping: 0,
      totalDiscount: 0,
      totalPrice: 49.95,
      shipments: [],
      items: [
        {
          id: 'pink-sweatshirt',
          sku: 'WG002-LIGHT-PINK-M',
          title: 'Sudadera Fernando',
          productType: 'Sudadera',
          color: 'Light Pink',
          size: 'M',
          quantity: 1,
          unitPrice: 49.95
        }
      ]
    });

    expect(breakdown.productCost).toBe(13.45);
  });

  it('calcula gastos fijos pendientes del mes', async () => {
    const result = await fixedExpenseService([
      {
        id: 'rent',
        name: 'Alquiler',
        category: 'ALQUILER',
        amount: 700,
        currency: 'EUR',
        dueDay: 1,
        active: true,
        matcher: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: [{ id: 'p1', amount: 700, paidAt: new Date() }]
      },
      {
        id: 'internet',
        name: 'Internet',
        category: 'TELECOM',
        amount: 50,
        currency: 'EUR',
        dueDay: 10,
        active: true,
        matcher: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: []
      },
      {
        id: 'old',
        name: 'Viejo',
        category: 'SOFTWARE',
        amount: 20,
        currency: 'EUR',
        dueDay: null,
        active: false,
        matcher: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: []
      }
    ]).fixedExpenses('2026-06');

    expect(result.period).toBe('2026-06');
    expect(result.totalMonthly).toBe(750);
    expect(result.paid).toBe(700);
    expect(result.pending).toBe(50);
    expect(result.activeCount).toBe(2);
    expect(result.upcoming.map((item) => item.name)).toEqual(['Internet']);
  });

  it('concilia los pagos de N26 sin contar duplicados técnicos', async () => {
    const expense = {
      id: 'shopify',
      name: 'Shopify',
      category: 'SOFTWARE',
      amount: 70,
      currency: 'EUR',
      dueDay: null,
      active: true,
      matcher: 'paypal shopify',
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      payments: []
    };
    const baseTransaction = {
      accountId: 'main',
      bookingDate: new Date('2026-08-23T00:00:00Z'),
      amount: -77.58,
      merchantName: 'PAYPAL *SHOPIFY',
      counterpartyName: null,
      remittanceInfo: 'PAYPAL *SHOPIFY REF-1'
    };
    const result = await fixedExpenseService([expense], [
      { ...baseTransaction, id: 'tx-1', description: 'PAYPAL *SHOPIFY REF-1' },
      { ...baseTransaction, id: 'tx-duplicate', description: 'PAYPAL- SHOPIFY REF-1' }
    ]).fixedExpenses('2026-08');

    expect(result.paid).toBe(77.58);
    expect(result.pending).toBe(0);
    expect(result.autoReconciledCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      paid: true,
      paidAmount: 77.58,
      paymentSource: 'BANK',
      reconciliationStatus: 'PAID'
    });
  });

  it('mantiene pendiente un recibo bancario rechazado', async () => {
    const result = await fixedExpenseService([
      {
        id: 'electricity',
        name: 'Luz taller (estimación)',
        category: 'SUMINISTROS',
        amount: 91.18,
        currency: 'EUR',
        dueDay: null,
        active: true,
        matcher: 'octopus energy',
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: []
      }
    ], [
      {
        id: 'tx-rejected',
        accountId: 'main',
        bookingDate: new Date('2026-08-21T00:00:00Z'),
        amount: -9,
        description: 'Pago domiciliado SEPA de 178,14 EUR a OCTOPUS ENERGY rechazado',
        merchantName: 'OCTOPUS ENERGY',
        counterpartyName: null,
        remittanceInfo: null
      }
    ]).fixedExpenses('2026-08');

    expect(result.paid).toBe(0);
    expect(result.pending).toBe(91.18);
    expect(result.rejectedCount).toBe(1);
    expect(result.items[0]).toMatchObject({ paid: false, reconciliationStatus: 'REJECTED' });
  });
});
