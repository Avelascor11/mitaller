import { describe, expect, it, vi } from 'vitest';
import { SupplierOrderService } from '../src/supplier/supplier-order.service';

function buildService(options: {
  matrix: unknown;
  supplierArticles?: unknown[];
  supplierStocks?: unknown[];
  createdOrder?: unknown;
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
      findMany: vi.fn().mockResolvedValue([]),
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
      supplierStocks: [{ supplierSku: '180000002', availableQuantity: 7 }]
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
            rawDataJson: expect.objectContaining({
              stockItemSupplierSku: 'FR-TS-WHT-M',
              resolvedSupplierSku: '180000002',
              resolvedStyleCode: 'TG002'
            })
          })]
        })
      })
    }));
  });
});
