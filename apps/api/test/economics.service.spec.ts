import { describe, expect, it } from 'vitest';
import { EconomicsService } from '../src/economics/economics.service';

function service(config: Record<string, string> = {}) {
  return new EconomicsService({} as never, { get: (key: string) => config[key] } as never, {} as never, { spendForRange: async () => 0 } as never) as unknown as {
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
  };
}

describe('EconomicsService', () => {
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
    expect(breakdown.productCost).toBe(3.29);
    expect(breakdown.wasteCost).toBeCloseTo(0.0658);
    expect(breakdown.taxReserve).toBe(8.25);
    expect(breakdown.cashFree).toBeCloseTo(38.2642);
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

    expect(breakdown.wasteCost).toBeCloseTo(0.1645);
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
});
