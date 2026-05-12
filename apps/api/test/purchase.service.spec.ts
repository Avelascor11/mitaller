import { describe, expect, it } from 'vitest';
import { PurchaseService } from '../src/purchasing/purchase.service';

describe('PurchaseService', () => {
  it('calcula compra recomendada con pedidos, stock de seguridad y stock interno', () => {
    const service = new PurchaseService({} as never, { get: () => undefined } as never);
    expect(service.calculateRecommendedPurchaseQuantity({
      pendingOrderNeed: 6,
      minStockTarget: 5,
      currentInternalStock: 3,
      alreadyOrderedQuantity: 2
    })).toBe(6);
  });

  it('no recomienda cantidades negativas', () => {
    const service = new PurchaseService({} as never, { get: () => undefined } as never);
    expect(service.calculateRecommendedPurchaseQuantity({
      pendingOrderNeed: 1,
      minStockTarget: 2,
      currentInternalStock: 10,
      alreadyOrderedQuantity: 0
    })).toBe(0);
  });

  it('prioriza tipo/color/talla del producto como la hoja de compras', () => {
    const service = new PurchaseService({} as never, { get: () => undefined } as never) as unknown as {
      mapOrderItemToBlankGarment: (item: {
        productType?: string;
        title: string;
        sku: string;
        color?: string;
        size?: string;
        variantTitle?: string;
      }, mappingIndex?: Map<string, string>) => { kind: string; color: string; size: string; subproductName: string } | null;
    };
    const mappingIndex = new Map([
      ['name:camiseta \"test\" - m', 'Camiseta Negra - M']
    ]);

    expect(service.mapOrderItemToBlankGarment({
      productType: 'Camiseta',
      title: 'Camiseta "Test" - M',
      sku: 'TEST-M',
      color: 'Blanca',
      size: 'M'
    }, mappingIndex)).toMatchObject({
      kind: 'CAMISETA',
      color: 'BLANCA',
      size: 'M',
      subproductName: 'Camiseta Blanca - M'
    });
  });

  it('no filtra pedidos importados desde hoja aunque sean anteriores al mínimo Shopify', () => {
    const service = new PurchaseService({} as never, { get: () => '9454' } as never) as unknown as {
      filterByMinimumOrderNumber: <T extends { order: { orderNumber: string; shopifyOrderId?: string } }>(items: T[]) => T[];
    };

    expect(service.filterByMinimumOrderNumber([
      { order: { orderNumber: '#9436', shopifyOrderId: 'sheet:#9436' } },
      { order: { orderNumber: '#9437', shopifyOrderId: 'gid://shopify/Order/1' } },
      { order: { orderNumber: '#9454', shopifyOrderId: 'gid://shopify/Order/2' } }
    ])).toEqual([
      { order: { orderNumber: '#9436', shopifyOrderId: 'sheet:#9436' } },
      { order: { orderNumber: '#9454', shopifyOrderId: 'gid://shopify/Order/2' } }
    ]);
  });
});
