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
            alreadyOrderedQuantity: 2,
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

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({ supplierSku: '180000002', quantity: 4 })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            rawDataJson: expect.objectContaining({
              alreadyPendingSupplierOrderQuantity: 2
            })
          })]
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

  it('resuelve camiseta sand como Falk & Ross Mastic y la muestra como Mastic', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'SAND',
          sizes: [{
            stockItemId: 'stock-mastic-shirt',
            supplierSku: 'FR-TS-SAND-M',
            subproductName: 'Camiseta Sand - M',
            size: 'M',
            recommendedPurchaseQuantity: 2,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 3,
            currentInternalStock: 1,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9567' }]
          }]
        }]
      },
      supplierArticles: [{
        supplierSku: '032427113',
        styleCode: '032.42',
        productName: 'TG002 - #E220 T-Shirt',
        color: 'Mastic',
        size: 'M',
        purchasePrice: null
      }],
      supplierStocks: [{
        supplierSku: '032427113',
        availableQuantity: 934,
        stockSpain24h: 429,
        stockCentral3To5Days: 505,
        stockSupplier5To20Days: 500
      }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({
            supplierSku: '032427113',
            name: 'Camiseta Mastic - M',
            quantity: 2
          })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '032427113',
            name: 'Camiseta Mastic - M',
            supplierAvailableQuantity: 934,
            rawDataJson: expect.objectContaining({
              resolvedSupplierSku: '032427113',
              resolvedStyleCode: '032.42'
            })
          })]
        })
      })
    }));
  });

  it('resuelve camiseta rosa con Falk & Ross 5000 / 180.09 Azalea en lugar de B&C TG002', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'ROSA',
          sizes: [{
            stockItemId: 'stock-pink',
            supplierSku: 'FR-TS-PNK-M',
            subproductName: 'Camiseta Rosa - M',
            size: 'M',
            recommendedPurchaseQuantity: 2,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 2,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9587' }]
          }]
        }]
      },
      supplierArticles: [
        {
          supplierSku: '032424253',
          styleCode: 'TG002',
          productName: 'B&C 032.42 Pink',
          color: 'Pink',
          size: 'M',
          purchasePrice: null
        },
        {
          supplierSku: '180095003',
          styleCode: '180.09',
          productName: '5000 - Heavy Cotton Adult T-Shirt',
          color: 'Azalea',
          size: 'M',
          purchasePrice: null
        }
      ],
      supplierStocks: [{ supplierSku: '180095003', availableQuantity: 12 }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          orderNote: expect.stringContaining('Camiseta Gildan 180.09'),
          lines: [expect.objectContaining({
            supplierSku: '180095003',
            name: 'Camiseta Azalea - M',
            quantity: 2
          })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '180095003',
            name: 'Camiseta Azalea - M',
            supplierAvailableQuantity: 12,
            rawDataJson: expect.objectContaining({
              stockItemSupplierSku: 'FR-TS-PNK-M',
              resolvedSupplierSku: '180095003',
              resolvedStyleCode: '180.09',
              expectedProductNumber: '180.09'
            })
          })]
        })
      })
    }));
  });

  it('resuelve camiseta marron con Falk & Ross 5000 / 180.09 Dark Chocolate en lugar de 102.09', async () => {
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
          styleCode: '102.09',
          productName: '2000 - Ultra Cotton Adult T-Shirt',
          color: 'Maroon',
          size: 'M',
          purchasePrice: null
        },
        {
          supplierSku: '180094454',
          styleCode: '180.09',
          productName: '5000 - Heavy Cotton Adult T-Shirt',
          color: 'Dark Chocolate',
          size: 'M',
          purchasePrice: null
        }
      ],
      supplierStocks: [{ supplierSku: '180094454', availableQuantity: 8 }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          orderNote: expect.stringContaining('Camiseta 032.42 -> 2.73 EUR'),
          lines: [expect.objectContaining({
            supplierSku: '180094454',
            name: 'Camiseta Dark Chocolate - M',
            quantity: 1
          })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '180094454',
            supplierAvailableQuantity: 8,
            rawDataJson: expect.objectContaining({
              stockItemSupplierSku: 'FR-TS-BRN-M',
              resolvedSupplierSku: '180094454',
              resolvedStyleCode: '180.09',
              expectedProductNumber: '180.09'
            })
          })]
        })
      })
    }));
  });

  it('resuelve camiseta tangerine con Gildan 5000 / 180.09', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'TANGERINE',
          sizes: [{
            stockItemId: 'stock-tangerine',
            supplierSku: 'FR-TS-TNG-M',
            subproductName: 'Camiseta Tangerine - M',
            size: 'M',
            recommendedPurchaseQuantity: 3,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 3,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9601' }]
          }]
        }]
      },
      supplierArticles: [
        {
          supplierSku: '032420123',
          styleCode: '032.42',
          productName: 'B&C 032.42 T-Shirt',
          color: 'Orange',
          size: 'M',
          purchasePrice: null
        },
        {
          supplierSku: '180090456',
          styleCode: '180.09',
          productName: '5000 - Heavy Cotton Adult T-Shirt',
          color: 'Tangerine',
          size: 'M',
          purchasePrice: null
        }
      ],
      supplierStocks: [{ supplierSku: '180090456', availableQuantity: 22 }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          orderNote: expect.stringContaining('Camiseta Gildan 180.09'),
          lines: [expect.objectContaining({
            supplierSku: '180090456',
            name: 'Camiseta Tangerine - M',
            quantity: 3
          })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '180090456',
            name: 'Camiseta Tangerine - M',
            supplierAvailableQuantity: 22,
            rawDataJson: expect.objectContaining({
              stockItemSupplierSku: 'FR-TS-TNG-M',
              resolvedSupplierSku: '180090456',
              resolvedStyleCode: '180.09',
              expectedProductNumber: '180.09'
            })
          })]
        })
      })
    }));
  });

  it('resuelve camiseta charcoal como B&C TG002 / 032.42 Dark Grey', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'CHARCOAL',
          sizes: [{
            stockItemId: 'stock-charcoal',
            supplierSku: 'FR-TS-CHC-L',
            subproductName: 'Camiseta Charcoal - L',
            size: 'L',
            recommendedPurchaseQuantity: 4,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 4,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9602' }]
          }]
        }]
      },
      supplierArticles: [
        {
          supplierSku: '180091111',
          styleCode: '180.09',
          productName: '5000 - Heavy Cotton Adult T-Shirt',
          color: 'Charcoal',
          size: 'L',
          purchasePrice: null
        },
        {
          supplierSku: '032421234',
          styleCode: '032.42',
          productName: 'TG002 - #E220 T-Shirt',
          color: 'Dark Grey',
          size: 'L',
          purchasePrice: null
        }
      ],
      supplierStocks: [{ supplierSku: '032421234', availableQuantity: 15 }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({
            supplierSku: '032421234',
            name: 'Camiseta Dark Grey - L',
            quantity: 4
          })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '032421234',
            name: 'Camiseta Dark Grey - L',
            supplierAvailableQuantity: 15,
            rawDataJson: expect.objectContaining({
              stockItemSupplierSku: 'FR-TS-CHC-L',
              resolvedSupplierSku: '032421234',
              resolvedStyleCode: '032.42',
              expectedProductNumber: '032.42'
            })
          })]
        })
      })
    }));
  });
});
