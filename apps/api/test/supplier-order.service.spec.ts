import { describe, expect, it, vi } from 'vitest';
import { SupplierOrderService } from '../src/supplier/supplier-order.service';

function buildService(options: {
  matrix: unknown;
  supplierArticles?: unknown[];
  supplierStocks?: unknown[];
  createdOrder?: unknown;
  existingSupplierOrders?: unknown[];
}) {
  const createdOrder = options.createdOrder ?? {
    id: 'supplier-order-1',
    supplier: 'FALK_ROSS',
    orderNumber: 'FR-20260602',
    status: 'DRAFT',
    lines: [{ id: 'line-1', supplierSku: '180000002', quantity: 2 }]
  };
  const prisma = {
    supplierPurchaseOrder: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn((args?: { where?: { status?: { in?: string[] } } }) => {
        const orders = options.existingSupplierOrders ?? [];
        const statuses = args?.where?.status?.in;
        if (!statuses) return Promise.resolve(orders);
        return Promise.resolve(orders.filter((order) => statuses.includes((order as { status?: string }).status ?? '')));
      }),
      create: vi.fn().mockResolvedValue(createdOrder)
    },
    supplierArticle: { findMany: vi.fn().mockResolvedValue(options.supplierArticles ?? []) },
    supplierStock: { findMany: vi.fn().mockResolvedValue(options.supplierStocks ?? []) }
  };
  const service = new SupplierOrderService(
    prisma as never,
    { get: vi.fn((key: string) => ({ FALKROSS_ALLOW_AUTO_SUBMIT: 'false', FALKROSS_SYNC_STOCK_BEFORE_ORDER: 'false' })[key]) } as never,
    { getPurchaseMatrix: vi.fn().mockResolvedValue(options.matrix) } as never,
    { syncStock: vi.fn(), submitPurchaseOrder: vi.fn(), orderMode: vi.fn(() => 'falkross-xml') } as never,
    { log: vi.fn() } as never
  );
  return { service, prisma };
}

describe('SupplierOrderService', () => {
  it('genera borrador diario sin enviarlo automaticamente aunque submit venga a true', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'BLANCA',
          sizes: [{
            stockItemId: 'stock-1',
            supplierSku: '180000002',
            subproductName: 'Camiseta Blanca - M',
            size: 'M',
            recommendedPurchaseQuantity: 2,
            supplierAvailableQuantity: 10,
            pendingOrderNeed: 2,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9510' }]
          }]
        }]
      }
    });

    const result = await service.generateDailyFalkRossOrder({ submit: true, source: 'cron' });

    expect(result.status).toBe('created');
    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalled();
  });

  it('resuelve camisetas B&C TG002 por color y talla antes de crear el pedido', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'BLANCA',
          sizes: [{
            stockItemId: 'stock-1',
            supplierSku: 'FR-TS-WHT-M',
            subproductName: 'Camiseta Blanca - M',
            size: 'M',
            recommendedPurchaseQuantity: 2,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 2,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9510' }]
          }]
        }]
      },
      supplierArticles: [{
        supplierSku: '180000002',
        styleCode: 'TG002',
        productName: 'B&C T-shirt 032.42',
        color: 'White',
        size: 'M',
        purchasePrice: null
      }],
      supplierStocks: [{
        supplierSku: '180000002',
        availableQuantity: 7,
        stockSpain24h: 3,
        stockCentral3To5Days: 4,
        stockSupplier5To20Days: 12
      }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({ supplierSku: '180000002', quantity: 2 })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '180000002',
            supplierAvailableQuantity: 7,
            supplierStockSpain24h: 3,
            supplierStockCentral3To5Days: 4,
            supplierStockSupplier5To20Days: 12,
            rawDataJson: expect.objectContaining({
              stockItemSupplierSku: 'FR-TS-WHT-M',
              resolvedSupplierSku: '180000002',
              resolvedStyleCode: 'TG002',
              supplierStockSpain24h: 3,
              supplierStockCentral3To5Days: 4,
              supplierStockSupplier5To20Days: 12
            })
          })]
        })
      })
    }));
  });

  it('no descuenta borradores antiguos al recomendar una nueva compra proveedor', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'BLANCA',
          sizes: [{
            stockItemId: 'stock-1',
            supplierSku: 'FR-TS-WHT-M',
            subproductName: 'Camiseta Blanca - M',
            size: 'M',
            recommendedPurchaseQuantity: 4,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 6,
            currentInternalStock: 2,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9510' }]
          }]
        }]
      },
      supplierArticles: [{
        supplierSku: '180000002',
        styleCode: 'TG002',
        productName: 'B&C T-shirt 032.42',
        color: 'White',
        size: 'M',
        purchasePrice: null
      }],
      supplierStocks: [{ supplierSku: '180000002', availableQuantity: 20 }],
      existingSupplierOrders: [{
        id: 'old-draft',
        status: 'DRAFT',
        lines: [{ stockItemId: 'stock-1', quantity: 4 }]
      }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplier: 'FALK_ROSS', status: { in: ['SUBMITTED'] } }
    }));
    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({ supplierSku: '180000002', quantity: 4 })]
        })
      })
    }));
  });

  it('mantiene necesidades en el borrador aunque Falk & Ross marque stock proveedor 0', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'BLANCA',
          sizes: [{
            stockItemId: 'stock-s',
            supplierSku: 'FR-TS-WHT-S',
            subproductName: 'Camiseta Blanca - S',
            size: 'S',
            recommendedPurchaseQuantity: 2,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 3,
            currentInternalStock: 1,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9510' }]
          }]
        }]
      },
      supplierArticles: [{
        supplierSku: '180000001',
        styleCode: 'TG002',
        productName: 'B&C T-shirt 032.42',
        color: 'White',
        size: 'S',
        purchasePrice: null
      }],
      supplierStocks: [{ supplierSku: '180000001', availableQuantity: 0 }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({ supplierSku: '180000001', quantity: 2 })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '180000001',
            quantity: 2,
            supplierAvailableQuantity: 0
          })]
        })
      })
    }));
  });

  it('resuelve sudadera azul como Royal Blue y no como Nordic Blue', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'SUDADERA',
          color: 'AZUL',
          sizes: [{
            stockItemId: 'stock-blue-hoodie',
            supplierSku: 'FR-HD-BLU-S',
            subproductName: 'Sudadera Azul - S',
            size: 'S',
            recommendedPurchaseQuantity: 1,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 1,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9577' }]
          }]
        }]
      },
      supplierArticles: [
        {
          supplierSku: '237422142',
          styleCode: '237.42',
          productName: 'WG005 - ID.333 Hoodie',
          color: 'Nordic Blue',
          size: 'S',
          purchasePrice: null
        },
        {
          supplierSku: '237423002',
          styleCode: '237.42',
          productName: 'WG005 - ID.333 Hoodie',
          color: 'Royal Blue',
          size: 'S',
          purchasePrice: null
        }
      ],
      supplierStocks: [
        { supplierSku: '237422142', availableQuantity: 0, stockSpain24h: 0, stockCentral3To5Days: 0, stockSupplier5To20Days: 0 },
        { supplierSku: '237423002', availableQuantity: 134, stockSpain24h: 36, stockCentral3To5Days: 98, stockSupplier5To20Days: 1500 }
      ]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({ supplierSku: '237423002', quantity: 1 })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '237423002',
            supplierAvailableQuantity: 134,
            supplierStockSpain24h: 36,
            supplierStockCentral3To5Days: 98,
            supplierStockSupplier5To20Days: 1500,
            rawDataJson: expect.objectContaining({
              resolvedSupplierSku: '237423002',
              resolvedStyleCode: '237.42'
            })
          })]
        })
      })
    }));
  });

  it('resuelve camiseta marron con Falk & Ross 2000 / 102.09 en lugar de B&C TG002', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'MARRON',
          sizes: [{
            stockItemId: 'stock-brown',
            supplierSku: 'FR-TS-BRN-M',
            subproductName: 'Camiseta Marron - M',
            size: 'M',
            recommendedPurchaseQuantity: 1,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 1,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9512' }]
          }]
        }]
      },
      supplierArticles: [
        {
          supplierSku: '180000111',
          styleCode: 'TG002',
          productName: 'B&C 032.42 Brown',
          color: 'Brown',
          size: 'M',
          purchasePrice: null
        },
        {
          supplierSku: '290000222',
          styleCode: '102.09',
          productName: '2000 - Ultra Cotton Adult T-Shirt',
          color: 'Maroon',
          size: 'M',
          purchasePrice: null
        }
      ],
      supplierStocks: [{ supplierSku: '290000222', availableQuantity: 8 }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          orderNote: expect.stringContaining('Camiseta 032.42 -> 2.73 EUR'),
          lines: [expect.objectContaining({ supplierSku: '290000222', quantity: 1 })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '290000222',
            supplierAvailableQuantity: 8,
            rawDataJson: expect.objectContaining({
              stockItemSupplierSku: 'FR-TS-BRN-M',
              resolvedSupplierSku: '290000222',
              resolvedStyleCode: '102.09',
              expectedProductNumber: '102.09'
            })
          })]
        })
      })
    }));
  });
});
