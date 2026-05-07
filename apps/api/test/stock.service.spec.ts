import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StockService } from '../src/stock/stock.service';

describe('StockService', () => {
  it('rechaza movimientos con cantidad no positiva', async () => {
    const service = new StockService({} as never, { log: vi.fn() } as never);
    await expect(service.moveStock({ stockItemId: 'sku', quantity: 0, reason: 'test' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
