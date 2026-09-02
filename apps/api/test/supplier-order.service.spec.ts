import { describe, expect, it, vi } from 'vitest';
import { SupplierOrderService } from '../src/supplier/supplier-order.service';

function buildService(options: {
  matrix: unknown;
  matrixAfterEnsure?: unknown;
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
    supplierStock: { findMany: vi.fn().mockResolvedValue(options.supplierStocks ?? []) },
    stockItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'stock-created' })
    }
  };
  const getPurchaseMatrix = vi.fn().mockResolvedValueOnce(options.matrix);
  getPurchaseMatrix.mockResolvedValue(options.matrixAfterEnsure ?? options.matrix);
  const service = new SupplierOrderService(
    prisma as never,
    { get: vi.fn((key: string) => ({ FALKROSS_ALLOW_AUTO_SUBMIT: 'false', FALKROSS_SYNC_STOCK_BEFORE_ORDER: 'false' })[key]) } as never,
    { getPurchaseMatrix } as never,
    { syncStock: vi.fn(), submitPurchaseOrder: vi.fn(), orderMode: vi.fn(() => 'falkross-xml') } as never,
    { log: vi.fn() } as never
  );
  return { service, prisma };
}

describe('SupplierOrderService', () => {
  it('separa la compra normal de la compra con stock de seguridad', async () => {
    const matrix = {
      groups: [{
        garmentType: 'CAMISETA',
        color: 'BLANCA',
        sizes: [{
          stockItemId: 'stock-1',
          supplierSku: '180000002',
          subproductName: 'Camiseta Blanca - M',
          size: 'M',
          recommendedPurchaseQuantity: 7,
          supplierAvailableQuantity: 20,
          pendingOrderNeed: 4,
          currentInternalStock: 2,
          minStockTarget: 5,
          demandOrders: [{ orderNumber: '#9510' }]
        }]
      }]
    };
    const normal = buildService({ matrix });
    const safety = buildService({ matrix });

    await normal.service.generateDailyFalkRossOrder({ source: 'manual', purchaseMode: 'NORMAL' });
    await safety.service.generateDailyFalkRossOrder({ source: 'manual', purchaseMode: 'SAFETY_STOCK' });

    expect(normal.prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({ purchaseMode: 'NORMAL', lines: [expect.objectContaining({ quantity: 2 })] })
      })
    }));
    expect(safety.prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({ purchaseMode: 'SAFETY_STOCK', lines: [expect.objectContaining({ quantity: 7 })] })
      })
    }));
  });

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

  it('resuelve Royal como Royal Blue y no confunde 65000 con el modelo 5000', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'AZUL',
          sizes: [{
            stockItemId: 'stock-blue-xxl',
            supplierSku: 'FR-TS-BLU-XXL',
            subproductName: 'Camiseta Azul - XXL',
            size: 'XXL',
            recommendedPurchaseQuantity: 1,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 1,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: [{ orderNumber: '#9940' }]
          }]
        }]
      },
      supplierArticles: [
        {
          supplierSku: 'wrong-65000',
          styleCode: '120.09',
          productName: '65000 - Softstyle Midweight Adult T-Shirt',
          color: 'Royal',
          size: '2XL',
          purchasePrice: '3.13'
        },
        {
          supplierSku: '032424506',
          styleCode: '032.42',
          productName: 'TG002 - #E220 T-Shirt',
          color: 'Royal',
          size: '2XL',
          purchasePrice: '4.24'
        }
      ],
      supplierStocks: [{ supplierSku: '032424506', availableQuantity: 12 }]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual', purchaseMode: 'NORMAL' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          lines: [expect.objectContaining({ supplierSku: '032424506', quantity: 1 })]
        })
      })
    }));
  });

  it('usa el SKU real de la camiseta Royal 3XL cuando Falk & Ross solo publica su stock', () => {
    const { service } = buildService({ matrix: { groups: [] } });
    const resolver = service as unknown as {
      resolveFalkRossStockOnlyFallback: (
        garmentType: string,
        color: string,
        size: string,
        stocks: Array<{ supplierSku: string }>
      ) => { supplierSku: string; size: string } | null;
    };

    expect(resolver.resolveFalkRossStockOnlyFallback(
      'CAMISETA',
      'AZUL',
      '3XL',
      [{ supplierSku: '032424257' }]
    )).toEqual(expect.objectContaining({ supplierSku: '032424257', size: '3XL' }));
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

  it('resuelve sudaderas con Falk & Ross WG002 / 208.42 y precio acordado', async () => {
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
          supplierSku: '208422142',
          styleCode: '208.42',
          productName: 'WG002 - Iconic 195 Hoodie',
          color: 'Nordic Blue',
          size: 'S',
          purchasePrice: null
        },
        {
          supplierSku: '208423002',
          styleCode: '208.42',
          productName: 'WG002 - Iconic 195 Hoodie',
          color: 'Royal Blue',
          size: 'S',
          purchasePrice: null
        }
      ],
      supplierStocks: [
        { supplierSku: '208422142', availableQuantity: 0, stockSpain24h: 0, stockCentral3To5Days: 0, stockSupplier5To20Days: 0 },
        { supplierSku: '208423002', availableQuantity: 134, stockSpain24h: 36, stockCentral3To5Days: 98, stockSupplier5To20Days: 1500 }
      ]
    });

    await service.generateDailyFalkRossOrder({ source: 'manual' });

    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rawRequestJson: expect.objectContaining({
          orderNote: expect.stringContaining('Sudadera 208.42 / WG002 -> 10.75 EUR'),
          lines: [expect.objectContaining({ supplierSku: '208423002', quantity: 1 })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '208423002',
            supplierAvailableQuantity: 134,
            supplierStockSpain24h: 36,
            supplierStockCentral3To5Days: 98,
            supplierStockSupplier5To20Days: 1500,
            purchasePrice: '10.75',
            rawDataJson: expect.objectContaining({
              resolvedSupplierSku: '208423002',
              resolvedStyleCode: '208.42',
              expectedProductNumber: '208.42'
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

  it('resuelve camiseta rosa con Falk & Ross 5000 / 180.09 Light Pink en lugar de B&C TG002', async () => {
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
          color: 'Light Pink',
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
            name: 'Camiseta Light Pink - M',
            quantity: 2
          })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            supplierSku: '180095003',
            name: 'Camiseta Light Pink - M',
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
          orderNote: expect.stringContaining('Camiseta 032.42 -> 2.70 EUR'),
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

  it('crea una compra extra separada con comentario y el precio acordado de 2,70', async () => {
    const { service, prisma } = buildService({
      matrix: {
        groups: [{
          garmentType: 'CAMISETA',
          color: 'BLANCA',
          sizes: [{
            stockItemId: 'stock-white-m',
            supplierSku: 'FR-TS-WHT-M',
            subproductName: 'Camiseta Blanca - M',
            size: 'M',
            recommendedPurchaseQuantity: 0,
            supplierAvailableQuantity: null,
            pendingOrderNeed: 0,
            currentInternalStock: 0,
            minStockTarget: 0,
            demandOrders: []
          }]
        }]
      },
      supplierArticles: [{
        supplierSku: '032420002',
        styleCode: '032.42',
        productName: 'TG002 - #E220 T-Shirt',
        color: 'White',
        size: 'M',
        purchasePrice: '4.24'
      }],
      supplierStocks: [{ supplierSku: '032420002', availableQuantity: 50 }]
    });

    const result = await service.generateExtraFalkRossOrder({
      lines: [{ stockItemId: 'stock-white-m', quantity: 6 }],
      comment: 'Mandar junto al pedido diario'
    });

    expect(result.status).toBe('created');
    expect(prisma.supplierPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderNumber: expect.stringMatching(/^FRX-/),
        rawRequestJson: expect.objectContaining({
          purchaseMode: 'EXTRA',
          orderNote: expect.stringContaining('Mandar junto al pedido diario'),
          lines: [expect.objectContaining({ supplierSku: '032420002', quantity: 6 })]
        }),
        lines: expect.objectContaining({
          create: [expect.objectContaining({
            stockItemId: 'stock-white-m',
            purchasePrice: '2.70',
            quantity: 6
          })]
        })
      })
    }));
  });

  it('añade la talla 3XL real al catálogo de compras extra sin stock de seguridad', async () => {
    const sizeEntry = (size: string, stockItemId: string | null, supplierSku: string | null, sku: string | null) => ({
      stockItemId,
      supplierSku,
      sku,
      subproductName: `Camiseta Blanca - ${size}`,
      size,
      recommendedPurchaseQuantity: 0,
      supplierAvailableQuantity: null,
      pendingOrderNeed: 0,
      currentInternalStock: 0,
      minStockTarget: 0,
      alreadyOrderedQuantity: 0,
      demandOrders: []
    });
    const baseGroup = {
      key: 'CAMISETA:BLANCA:',
      garmentType: 'CAMISETA',
      color: 'BLANCA',
      title: 'Camiseta Blanca',
      theme: { background: '#fff', foreground: '#000' }
    };
    const matrix = {
      sizes: ['S', '3XL'],
      generatedAt: new Date(),
      groups: [{
        ...baseGroup,
        sizes: [
          sizeEntry('S', 'stock-white-s', 'FR-TS-WHT-S', 'BLANK-TS-WHT-S'),
          sizeEntry('3XL', null, null, null)
        ]
      }]
    };
    const matrixAfterEnsure = {
      ...matrix,
      groups: [{
        ...baseGroup,
        sizes: [
          sizeEntry('S', 'stock-white-s', 'FR-TS-WHT-S', 'BLANK-TS-WHT-S'),
          sizeEntry('3XL', 'stock-white-3xl', '032420007', 'BLANK-TS-WHT-3XL')
        ]
      }]
    };
    const supplierArticles = [
      {
        supplierSku: '032420002',
        styleCode: '032.42',
        productName: 'TG002 - #E220 T-Shirt',
        color: 'White',
        size: 'S',
        purchasePrice: '4.24'
      },
      {
        supplierSku: '032420007',
        styleCode: '032.42',
        productName: 'TG002 - #E220 T-Shirt',
        color: 'White',
        size: '3XL',
        purchasePrice: '5.30'
      }
    ];
    const { service, prisma } = buildService({
      matrix,
      matrixAfterEnsure,
      supplierArticles,
      supplierStocks: [{ supplierSku: '032420007', availableQuantity: 619 }]
    });

    const result = await service.getExtraPurchaseCatalog();

    expect(prisma.stockItem.upsert).toHaveBeenCalledWith({
      where: { sku: 'BLANK-TS-WHT-3XL' },
      create: expect.objectContaining({
        sku: 'BLANK-TS-WHT-3XL',
        size: '3XL',
        supplierSku: '032420007',
        minStock: 0
      }),
      update: expect.objectContaining({
        size: '3XL',
        supplierSku: '032420007',
        minStock: 0
      })
    });
    expect(result.groups[0]?.items).toContainEqual(expect.objectContaining({
      stockItemId: 'stock-white-3xl',
      supplierSku: '032420007',
      size: '3XL',
      unitPrice: 2.7,
      availableQuantity: 619
    }));
  });
});
