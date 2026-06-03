import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InfluencersService } from '../src/influencers/influencers.service';

function serviceWith(prisma: Record<string, any>) {
  return new InfluencersService(prisma as never);
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
          { status: 'OPEN' },
          { status: 'AWAITING_CONTENT' },
          { status: 'CLOSED' }
        ])
      },
      ugcSubmission: {
        findMany: vi.fn().mockResolvedValue([{ status: 'PENDING' }, { status: 'APPROVED' }])
      }
    };

    const result = await serviceWith(prisma).summary();

    expect(result).toEqual(expect.objectContaining({
      influencers: 2,
      activeCollaborations: 2,
      awaitingContent: 1,
      pendingSubmissions: 1,
      byStage: { PROSPECT: 1, CONTACTED: 1 }
    }));
  });

  it('rechaza fases no soportadas', async () => {
    const prisma = {
      influencer: { findMany: vi.fn() },
      collaboration: { findMany: vi.fn() },
      ugcSubmission: { findMany: vi.fn() }
    };

    expect(() => serviceWith(prisma).list({ stage: 'ENVIADO_A_MI_PRIMO' })).toThrow(BadRequestException);
  });
});
