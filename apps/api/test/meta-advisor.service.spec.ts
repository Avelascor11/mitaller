import { describe, expect, it, vi } from 'vitest';
import { MetaService } from '../src/meta/meta.service';

function serviceWith() {
  return new MetaService(
    { get: vi.fn((key: string) => ({ META_ACCESS_TOKEN: 'token', META_AD_ACCOUNT_ID: '123' })[key]) } as never,
    {} as never,
    { trackAutopilotAlert: vi.fn() } as never
  );
}

describe('MetaService advisor', () => {
  it('detecta campañas candidatas a pausar cuando gastan sin compras', async () => {
    const service = serviceWith();
    vi.spyOn(service, 'summary').mockResolvedValue({
      from: '2026-06-11',
      to: '2026-06-11',
      configured: true,
      currency: 'EUR',
      spend: 42,
      attributedRevenue: 0,
      purchases: 0,
      roas: 0,
      activeCampaigns: 1,
      campaigns: [{
        id: 'camp-1',
        name: 'Prospecting camiseta',
        status: 'ACTIVE',
        objective: 'OUTCOME_SALES',
        spend: 24.5,
        impressions: 3000,
        clicks: 40,
        ctr: 1.33,
        cpc: 0.61,
        reach: 2600,
        purchases: 0,
        purchaseValue: 0,
        roas: 0
      }],
      recommendations: [],
      bestSellers: []
    });
    vi.spyOn(service, 'weekendCash').mockResolvedValue({
      from: '2026-06-11',
      to: '2026-06-11',
      currency: 'EUR',
      isWeekend: false,
      status: 'INFO',
      headline: 'Entre semana',
      spend: 42,
      salesRevenue: 0,
      pendingShopifyPayout: 0,
      maxWeekendSpend: 0,
      remainingWeekendSpend: 0,
      spendToSalesPct: null,
      activeCampaigns: 1,
      shouldScale: false,
      actions: []
    });
    vi.spyOn(service, 'billingStatus').mockResolvedValue({
      configured: true,
      accountId: 'act_123',
      accountName: 'Meta Ads',
      accountStatus: 1,
      currency: 'EUR',
      balanceDue: 15,
      amountSpent: 100,
      spendCap: null,
      paymentLimit: 200,
      warningThreshold: 150,
      status: 'GOOD',
      headline: 'Saldo controlado',
      action: 'Puedes esperar'
    });

    const result = await service.advisor({
      question: 'que pauso hoy?',
      from: '2026-06-11',
      to: '2026-06-11'
    });

    expect(result.headline).toContain('bajaría');
    expect(result.answer).toContain('Prospecting camiseta');
    expect(result.nextActions[0]).toContain('Prospecting camiseta');
    expect(result.campaigns[0]).toEqual(expect.objectContaining({
      id: 'camp-1',
      advice: 'Pausar si sigue sin compras'
    }));
  });
});
