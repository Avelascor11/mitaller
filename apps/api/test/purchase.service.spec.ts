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
});
