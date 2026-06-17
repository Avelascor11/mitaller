import { describe, expect, it } from 'vitest';
import { PurchaseService } from '../src/purchasing/purchase.service';

describe('PurchaseService', () => {
  it('calcula compra recomendada con pedidos pendientes y stock fisico', () => {
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

  it('mantiene el tipo real del pedido si un mapeo antiguo confunde sudadera con camiseta', () => {
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
      ['sku:SFASTER-XL', 'Camiseta Sand - XL']
    ]);

    expect(service.mapOrderItemToBlankGarment({
      productType: 'Sudadera',
      title: 'Sudadera "Fernando is faster than you" - XL',
      sku: 'SFASTER-XL',
      color: 'Mastic',
      size: 'XL',
      variantTitle: 'XL'
    }, mappingIndex)).toMatchObject({
      kind: 'SUDADERA',
      color: 'SAND',
      size: 'XL',
      subproductName: 'Sudadera Sand - XL'
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

  it('incluye bañadores en compras recomendadas aunque no vayan a Falk & Ross', async () => {
    const service = new PurchaseService({
      stockItem: {
        findMany: async ({ where }: { where: { type: string } }) => where.type === 'BLANK_GARMENT'
          ? [
            {
              id: 'swim-blue-m',
              sku: 'BANADOR-AZUL-M',
              supplierSku: '55',
              name: 'Bañador Azul - M',
              color: 'Azul',
              size: 'M',
              minStock: 0,
              levels: []
            }
          ]
          : []
      },
      orderItem: {
        findMany: async () => [
          {
            id: 'item-1',
            orderId: 'order-1',
            quantity: 1,
            title: 'Bañador "55"',
            sku: 'NO-SKU-55-M',
            productType: 'Bañador',
            color: null,
            size: 'M',
            variantTitle: 'M',
            imageUrl: null,
            imageUrlsJson: null,
            order: { id: 'order-1', orderNumber: '#9604', shopifyOrderId: 'gid://shopify/Order/9604', customerName: 'Test' }
          }
        ]
      },
      supplierStock: { findMany: async () => [] },
      purchaseNeed: { findMany: async () => [] },
      productSubproductMapping: { findMany: async () => [] }
    } as never, { get: () => '9454' } as never);

    const matrix = await service.getPurchaseMatrix();
    const swim = matrix.groups.find((group) => group.garmentType === 'BAÑADOR');
    expect(swim?.title).toBe('BAÑADORES AZUL');
    expect(swim?.sizes.find((entry) => entry.size === 'M')).toMatchObject({
      pendingOrderNeed: 1,
      currentInternalStock: 0,
      recommendedPurchaseQuantity: 1
    });
  });

  it('genera compras DTF por diseño limpio para prendas externas', async () => {
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
            quantity: 1,
            title: 'Sudadera "Always Racing" - Navy - XL',
            sku: 'ALWAYS-HOODIE-NAVY-XL',
            productType: 'Sudadera',
            color: 'Navy',
            size: 'XL',
            variantTitle: 'XL',
            order: { orderNumber: '#9583', shopifyOrderId: 'gid://shopify/Order/9583' }
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
          },
          {
            quantity: 1,
            title: 'Camiseta "Quattro" - Blanca - S',
            sku: 'QUATTRO-BLANCA-S',
            productType: 'Camiseta',
            color: 'Blanca',
            size: 'S',
            variantTitle: 'S',
            order: { orderNumber: '#9599', shopifyOrderId: 'gid://shopify/Order/9599' }
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
            productName: 'Sudadera "Fernando is Faster" - Mastic - M',
            productType: 'Sudadera',
            color: 'Mastic',
            size: 'M',
            sku: 'FERNANDO-FASTER-MASTIC-M',
            subproductName: 'Sudadera Mastic - M',
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
    expect(dtf?.sizes).toHaveLength(4);
    expect(dtf?.sizes.find((entry) => entry.subproductName === 'DTF Always Racing')).toMatchObject({
      subproductName: 'DTF Always Racing',
      pendingOrderNeed: 3,
      recommendedPurchaseQuantity: 3
    });
    expect(dtf?.sizes.find((entry) => entry.subproductName === 'DTF No Risk No Story')).toMatchObject({
      pendingOrderNeed: 0,
      recommendedPurchaseQuantity: 0
    });
    expect(dtf?.sizes.find((entry) => entry.subproductName === 'DTF Fernando is Faster')).toMatchObject({
      pendingOrderNeed: 0,
      recommendedPurchaseQuantity: 0
    });
    expect(dtf?.sizes.find((entry) => entry.subproductName === 'DTF Quattro')).toMatchObject({
      pendingOrderNeed: 1,
      recommendedPurchaseQuantity: 1
    });
    expect(dtf?.sizes.map((entry) => entry.subproductName)).not.toContain('DTF Sudadera "Always Racing"');
  });

  it('no marca un pedido como completo si falta el DTF aunque haya prenda base', async () => {
    const service = new PurchaseService({
      stockItem: {
        findMany: async ({ where }: { where: { type: string; sku?: { startsWith: string } } }) => {
          if (where.type === 'BLANK_GARMENT') {
            return [
              {
                id: 'tee-navy-m',
                sku: 'TEE-NAVY-M',
                supplierSku: 'TEE-NAVY-M',
                name: 'Camiseta Navy - M',
                color: 'Navy',
                size: 'M',
                levels: [{ quantity: 1 }]
              }
            ];
          }
          if (where.type === 'TRANSFER') {
            return [
              {
                id: 'dtf-always',
                sku: 'DTF-ALWAYS-RACING',
                name: 'DTF Always Racing',
                levels: [{ quantity: 0 }]
              }
            ];
          }
          return [];
        }
      },
      productSubproductMapping: { findMany: async () => [] },
      order: {
        findMany: async () => [
          {
            id: 'order-1',
            orderNumber: '#9701',
            customerName: 'Test',
            operationalStatus: 'NEW',
            orderedAt: new Date('2026-06-17T08:00:00Z'),
            items: [
              {
                id: 'item-1',
                quantity: 1,
                title: 'Camiseta "Always Racing" - Navy - M',
                sku: 'ALWAYS-NAVY-M',
                productType: 'Camiseta',
                color: 'Navy',
                size: 'M',
                variantTitle: 'M',
                unitPrice: 29.95,
                imageUrl: null,
                imageUrlsJson: null
              }
            ]
          }
        ]
      }
    } as never, { get: () => undefined } as never);

    const response = await service.getFulfillableOrders();
    expect(response.summary.full).toBe(0);
    expect(response.summary.partial).toBe(1);
    expect(response.orders[0].fulfillability).toBe('PARTIAL');
    expect(response.orders[0].lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ subproductName: 'Camiseta Navy - M', canFulfill: true }),
      expect.objectContaining({ subproductName: 'DTF Always Racing', required: 1, available: 0, canFulfill: false })
    ]));
  });
});
