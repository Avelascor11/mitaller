import { describe, expect, it } from 'vitest';
import { PurchaseService } from '../src/purchasing/purchase.service';

describe('PurchaseService', () => {
  it('calcula compra recomendada ignorando unidades ya pedidas', () => {
    const service = new PurchaseService({} as never, { get: () => undefined } as never);
    expect(service.calculateRecommendedPurchaseQuantity({
      pendingOrderNeed: 6,
      minStockTarget: 5,
      currentInternalStock: 3,
      alreadyOrderedQuantity: 2
    })).toBe(8);
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

  it('prioriza el subproducto mapeado porque es la ropa base a comprar', () => {
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
      color: 'NEGRA',
      size: 'M',
      subproductName: 'Camiseta Negra - M'
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

  it('incluye lineas reservadas en compras porque comprado ya no se tiene en cuenta', async () => {
    const service = new PurchaseService({
      stockItem: { findMany: async () => [] },
      orderItem: {
        findMany: async () => [
          {
            quantity: 1,
            title: 'Camiseta "Always Racing" - Navy - M',
            sku: 'TEST-NAVY-M',
            productType: 'Camiseta',
            color: 'Navy',
            size: 'M',
            variantTitle: 'M',
            order: { orderNumber: '#9436', shopifyOrderId: 'sheet:#9436' }
          }
        ]
      },
      supplierStock: { findMany: async () => [] },
      purchaseNeed: { findMany: async () => [] },
      productSubproductMapping: { findMany: async () => [] }
    } as never, { get: () => '9454' } as never);

    const matrix = await service.getPurchaseMatrix();
    const navy = matrix.groups.find((group) => group.title === 'CAMISETAS NAVY');
    expect(navy?.sizes.find((entry) => entry.size === 'M')?.pendingOrderNeed).toBe(1);
    expect(navy?.sizes.find((entry) => entry.size === 'M')?.recommendedPurchaseQuantity).toBe(1);
  });

  it('genera compras DTF solo para camisetas de colores externos', async () => {
    const service = new PurchaseService({
      stockItem: { findMany: async () => [] },
      orderItem: {
        findMany: async () => [
          {
            quantity: 2,
            title: 'Camiseta "Always Racing" - Navy - M',
            sku: 'ALWAYS-NAVY-M',
            productType: 'Camiseta',
            color: 'Navy',
            size: 'M',
            variantTitle: 'M',
            order: { orderNumber: '#9436', shopifyOrderId: 'sheet:#9436' }
          },
          {
            quantity: 3,
            title: 'Camiseta "Delta" - Blanca - L',
            sku: 'DELTA-BLANCA-L',
            productType: 'Camiseta',
            color: 'Blanca',
            size: 'L',
            variantTitle: 'L',
            order: { orderNumber: '#9454', shopifyOrderId: 'gid://shopify/Order/1' }
          }
        ]
      },
      supplierStock: { findMany: async () => [] },
      purchaseNeed: { findMany: async () => [] },
      productSubproductMapping: {
        findMany: async () => [
          {
            productName: 'Camiseta "No Risk No Story" - Negro - L',
            productType: 'Camiseta',
            color: 'Negro',
            size: 'L',
            sku: 'NO-RISK-L',
            subproductName: 'Camiseta Negra - L',
            imageRef: null
          },
          {
            productName: 'Camiseta "Solo Interna" - Blanca - L',
            productType: 'Camiseta',
            color: 'Blanca',
            size: 'L',
            sku: 'INTERNA-L',
            subproductName: 'Camiseta Blanca - L',
            imageRef: null
          }
        ]
      }
    } as never, { get: () => '9454' } as never);

    const matrix = await service.getPurchaseMatrix();
    const dtf = matrix.groups.find((group) => group.title === 'DTF EXTERNO');
    expect(dtf?.sizes).toHaveLength(2);
    expect(dtf?.sizes.find((entry) => entry.subproductName === 'DTF Always Racing')).toMatchObject({
      subproductName: 'DTF Always Racing',
      pendingOrderNeed: 2,
      recommendedPurchaseQuantity: 2
    });
    expect(dtf?.sizes.find((entry) => entry.subproductName === 'DTF No Risk No Story')).toMatchObject({
      pendingOrderNeed: 0,
      recommendedPurchaseQuantity: 0
    });
  });
});
