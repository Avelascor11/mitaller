import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InfluencersService } from '../src/influencers/influencers.service';

function serviceWith(prisma: Record<string, any>) {
  return new InfluencersService(prisma as never, { get: vi.fn() } as never);
}

describe('InfluencersService', () => {
  it('crea influs normalizando el handle de Instagram', async () => {
    const prisma = {
      influencer: {
        upsert: vi.fn().mockResolvedValue({
          id: 'influ-1',
          igHandle: 'nuriaugc',
          tags: [],
          collaborations: [],
          submissions: []
        })
      }
    };

    await serviceWith(prisma).createInfluencer({
      igHandle: '@NuriaUGC',
      fullName: 'Nuria',
      stage: 'CONTACTED'
    });

    expect(prisma.influencer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { igHandle: 'nuriaugc' },
      create: expect.objectContaining({
        igHandle: 'nuriaugc',
        fullName: 'Nuria',
        stage: 'CONTACTED'
      })
    }));
  });

  it('resume el pipeline de influs y contenido pendiente', async () => {
    const prisma = {
      influencer: {
        findMany: vi.fn().mockResolvedValue([{ stage: 'PROSPECT' }, { stage: 'CONTACTED' }])
      },
      collaboration: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', status: 'OPEN', shopifyOrderId: null, shopifyOrderName: null },
          { id: 'c2', status: 'AWAITING_CONTENT', shopifyOrderId: null, shopifyOrderName: null },
          { id: 'c3', status: 'CLOSED', shopifyOrderId: null, shopifyOrderName: null }
        ])
      },
      ugcSubmission: {
        findMany: vi.fn().mockResolvedValue([{ status: 'PENDING' }, { status: 'APPROVED' }])
      },
      order: {
        findMany: vi.fn().mockResolvedValue([])
      }
    };

    const result = await serviceWith(prisma).summary();

    expect(result).toEqual(expect.objectContaining({
      influencers: 2,
      activeCollaborations: 2,
      awaitingContent: 1,
      pendingSubmissions: 1,
      packsShipped: 0,
      packsDelivered: 0,
      byStage: { PROSPECT: 1, CONTACTED: 1 }
    }));
  });

  it('añade estado de envío a las colaboraciones con pedido de Shopify', async () => {
    const prisma = {
      influencer: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'influ-1',
            igHandle: 'piloto',
            collaborations: [
              {
                id: 'collab-1',
                influencerId: 'influ-1',
                title: 'Pack regalo',
                status: 'PRODUCT_SENT',
                shopifyOrderId: null,
                shopifyOrderName: '#9701'
              }
            ],
            submissions: []
          }
        ])
      },
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'order-1',
            shopifyOrderId: 'gid://shopify/Order/9701',
            orderNumber: '#9701',
            operationalStatus: 'SHIPPED',
            updatedAt: new Date('2026-06-17T10:00:00Z'),
            shipments: [
              {
                id: 'shipment-1',
                status: 'IN_TRANSIT',
                trackingStatus: 'En reparto',
                trackingNumber: 'TRACK123',
                trackingUrl: 'https://tracking.test/TRACK123',
                carrier: 'Correos',
                trackingSyncedAt: new Date('2026-06-17T11:00:00Z'),
                updatedAt: new Date('2026-06-17T11:00:00Z')
              }
            ]
          }
        ])
      }
    };

    const result = await serviceWith(prisma).list({});

    expect(result[0].collaborations[0]).toMatchObject({
      fulfillment: {
        status: 'IN_TRANSIT',
        label: 'En camino',
        orderNumber: '#9701',
        trackingNumber: 'TRACK123',
        carrier: 'Correos'
      }
    });
  });

  it('rechaza fases no soportadas', async () => {
    const prisma = {
      influencer: { findMany: vi.fn() },
      collaboration: { findMany: vi.fn() },
      ugcSubmission: { findMany: vi.fn() }
    };

    await expect(serviceWith(prisma).list({ stage: 'ENVIADO_A_MI_PRIMO' })).rejects.toThrow(BadRequestException);
  });

  it('marca una colaboración como recibida y pendiente de contenido', async () => {
    const prisma = {
      collaboration: {
        findUnique: vi.fn().mockResolvedValue({ id: 'collab-1', notes: 'Pack enviado' }),
        update: vi.fn().mockResolvedValue({ id: 'collab-1', status: 'AWAITING_CONTENT' })
      }
    };

    await serviceWith(prisma).markCollaborationReceived('collab-1');

    expect(prisma.collaboration.update).toHaveBeenCalledWith({
      where: { id: 'collab-1' },
      data: {
        status: 'AWAITING_CONTENT',
        notes: expect.stringContaining('Producto recibido por la influ')
      },
      include: { influencer: true, submissions: true }
    });
  });
});
