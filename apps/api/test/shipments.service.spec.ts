import { describe, expect, it, vi } from 'vitest';
import { ShipmentsService } from '../src/shipments/shipments.service';

function serviceWith(prisma: Record<string, any>) {
  return new ShipmentsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

describe('ShipmentsService', () => {
  it('agrupa pedidos finalizados por dia de taller', async () => {
    const prisma = {
      shipment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'shipment-1', updatedAt: new Date('2026-06-09T08:00:00Z') },
          { id: 'shipment-2', updatedAt: new Date('2026-06-09T20:30:00Z') },
          { id: 'shipment-3', updatedAt: new Date('2026-06-08T10:00:00Z') }
        ])
      }
    };

    const summary = await serviceWith(prisma).finalizedDailySummary(60);

    expect(summary.timezone).toBe('Europe/Madrid');
    expect(summary.total).toBe(3);
    expect(summary.days).toContainEqual({ date: '2026-06-09', count: 2 });
    expect(summary.days).toContainEqual({ date: '2026-06-08', count: 1 });
    expect(prisma.shipment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['IN_TRANSIT', 'DELIVERED'] }
      }),
      select: { id: true, updatedAt: true }
    }));
  });
});
