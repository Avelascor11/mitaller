import { describe, expect, it, vi } from 'vitest';
import { MetaService } from '../src/meta/meta.service';

function serviceWith(prisma: Record<string, any>, configValues: Record<string, string | undefined> = {}) {
  return new MetaService(
    { get: vi.fn((key: string) => configValues[key]) } as never,
    prisma as never
  );
}

describe('MetaService Instagram webhook', () => {
  it('crea una influ desde un mensaje entrante de colaboracion aunque no haya username resuelto', async () => {
    const prisma = {
      influencer: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'influ-1',
          igHandle: 'ig_12345',
          detectionScore: 75,
          detectionReason: 'pide colaborar'
        })
      }
    };

    const result = await serviceWith(prisma).handleInstagramWebhook({
      object: 'instagram',
      entry: [{
        messaging: [{
          sender: { id: '12345' },
          timestamp: 1770000000000,
          message: { text: 'Hola, soy creadora UGC y me interesa colaborar con vosotros' }
        }]
      }]
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, received: 1, processed: 1 }));
    expect(prisma.influencer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        igHandle: 'ig_12345',
        manychatId: '12345',
        stage: 'CONTACTED',
        tags: expect.arrayContaining(['instagram-webhook', 'collab']),
        lastMessage: 'Hola, soy creadora UGC y me interesa colaborar con vosotros',
        source: 'instagram_dm',
        detectionScore: expect.any(Number),
        detectionReason: expect.any(String),
        suggestedAction: expect.any(String)
      })
    });
  });

  it('ignora mensajes normales de soporte que no parecen de influencer', async () => {
    const prisma = {
      influencer: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn()
      }
    };

    const result = await serviceWith(prisma).handleInstagramWebhook({
      object: 'instagram',
      entry: [{
        messaging: [{
          sender: { id: 'client-1' },
          timestamp: 1770000000000,
          message: { text: 'Hola, donde esta mi pedido?' }
        }]
      }]
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, received: 1, processed: 0, ignored: 1 }));
    expect(prisma.influencer.create).not.toHaveBeenCalled();
  });

  it('acepta el challenge solo si el verify token coincide', () => {
    const service = serviceWith({}, { META_WEBHOOK_VERIFY_TOKEN: 'token-test' });

    expect(service.verifyWebhookChallenge('subscribe', 'token-test')).toBe(true);
    expect(service.verifyWebhookChallenge('subscribe', 'otro')).toBe(false);
  });
});
