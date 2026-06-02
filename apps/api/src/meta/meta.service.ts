import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const GRAPH = 'https://graph.facebook.com';

export interface CampaignInsight {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  reach: number;
  purchases: number;
  purchaseValue: number;
  roas: number | null;
}

export interface BestSeller {
  sku: string | null;
  title: string;
  quantity: number;
  revenue: number;
}

export interface CreateCampaignDto {
  name: string;
  // objective + targeting source: an existing campaign to clone structure from
  templateCampaignId?: string;
  objective?: string; // fallback if no template (e.g. OUTCOME_SALES)
  dailyBudget: number; // in EUR
  // creative
  message: string;
  headline?: string;
  description?: string;
  link: string;
  imageUrl: string;
  callToAction?: string; // e.g. SHOP_NOW
  startTime?: string; // ISO; default now
}

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  // ---------- config ----------
  private get token() { return this.config.get<string>('META_ACCESS_TOKEN') ?? ''; }
  private get adAccount() {
    const raw = this.config.get<string>('META_AD_ACCOUNT_ID') ?? '';
    return raw.startsWith('act_') ? raw : raw ? `act_${raw}` : '';
  }
  private get pageId() { return this.config.get<string>('META_PAGE_ID') ?? ''; }
  private get instagramId() { return this.config.get<string>('META_INSTAGRAM_ID') ?? ''; }
  private get version() { return this.config.get<string>('META_API_VERSION') ?? 'v21.0'; }

  hasCredentials() { return Boolean(this.token && this.adAccount); }

  private assert() {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Meta Ads no configurado (falta META_ACCESS_TOKEN o META_AD_ACCOUNT_ID)');
    }
  }

  // ---------- low-level Graph calls ----------
  private async graphGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${GRAPH}/${this.version}/${path}`);
    url.searchParams.set('access_token', this.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok) {
      this.logger.error(`Meta GET ${path} failed: ${JSON.stringify(json?.error ?? json)}`);
      throw new BadRequestException(json?.error?.message ?? 'Error en la API de Meta');
    }
    return json as T;
  }

  private async graphPost<T>(path: string, body: Record<string, any>): Promise<T> {
    const url = `${GRAPH}/${this.version}/${path}`;
    const form = new URLSearchParams();
    form.set('access_token', this.token);
    for (const [k, v] of Object.entries(body)) {
      form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const res = await fetch(url, { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) {
      this.logger.error(`Meta POST ${path} failed: ${JSON.stringify(json?.error ?? json)}`);
      throw new BadRequestException(json?.error?.message ?? 'Error creando en Meta');
    }
    return json as T;
  }

  // ---------- spend ----------
  /** Total spend for a single day (YYYY-MM-DD). Returns 0 if not configured. */
  async dailySpend(date?: string): Promise<{ date: string; spend: number; currency: string }> {
    const day = date ?? new Date().toISOString().slice(0, 10);
    if (!this.hasCredentials()) return { date: day, spend: 0, currency: 'EUR' };
    const data = await this.graphGet<{ data: Array<{ spend?: string }> }>(`${this.adAccount}/insights`, {
      fields: 'spend',
      time_range: JSON.stringify({ since: day, until: day }),
      level: 'account'
    });
    const spend = Number(data.data?.[0]?.spend ?? 0);
    return { date: day, spend: +spend.toFixed(2), currency: 'EUR' };
  }

  /** Total spend for a range. Safe: returns 0 if not configured. */
  async spendForRange(from: string, to: string): Promise<number> {
    if (!this.hasCredentials()) return 0;
    try {
      const data = await this.graphGet<{ data: Array<{ spend?: string }> }>(`${this.adAccount}/insights`, {
        fields: 'spend',
        time_range: JSON.stringify({ since: from, until: to }),
        level: 'account'
      });
      return +Number(data.data?.[0]?.spend ?? 0).toFixed(2);
    } catch (e) {
      this.logger.warn(`spendForRange failed: ${(e as Error).message}`);
      return 0;
    }
  }

  // ---------- campaigns + insights ----------
  async campaigns(from: string, to: string): Promise<CampaignInsight[]> {
    this.assert();
    const time = JSON.stringify({ since: from, until: to });
    const data = await this.graphGet<{ data: any[] }>(`${this.adAccount}/campaigns`, {
      fields: [
        'name',
        'status',
        'objective',
        `insights.time_range(${time}){spend,impressions,clicks,ctr,cpc,reach,actions,action_values}`
      ].join(','),
      limit: '100'
    });
    return (data.data ?? []).map((c) => this.mapCampaign(c));
  }

  private mapCampaign(c: any): CampaignInsight {
    const ins = c.insights?.data?.[0];
    const actions: any[] = ins?.actions ?? [];
    const values: any[] = ins?.action_values ?? [];
    const purchaseAction = actions.find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
    const purchaseValue = values.find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
    const spend = Number(ins?.spend ?? 0);
    const pv = Number(purchaseValue?.value ?? 0);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective ?? null,
      spend: +spend.toFixed(2),
      impressions: Number(ins?.impressions ?? 0),
      clicks: Number(ins?.clicks ?? 0),
      ctr: ins?.ctr != null ? +Number(ins.ctr).toFixed(2) : null,
      cpc: ins?.cpc != null ? +Number(ins.cpc).toFixed(2) : null,
      reach: Number(ins?.reach ?? 0),
      purchases: Number(purchaseAction?.value ?? 0),
      purchaseValue: +pv.toFixed(2),
      roas: spend > 0 ? +(pv / spend).toFixed(2) : null
    };
  }

  // ---------- best sellers (from our DB orders) ----------
  async bestSellers(from: string, to: string, limit = 10): Promise<BestSeller[]> {
    const start = new Date(`${from}T00:00:00.000`);
    const end = new Date(`${to}T23:59:59.999`);
    const orders = await this.prisma.order.findMany({
      where: { orderedAt: { gte: start, lte: end } },
      include: { items: true }
    });
    const map = new Map<string, BestSeller>();
    for (const o of orders) {
      for (const it of o.items) {
        const key = it.sku || it.title;
        const acc = map.get(key) ?? { sku: it.sku ?? null, title: it.title, quantity: 0, revenue: 0 };
        acc.quantity += it.quantity;
        acc.revenue += (it.unitPrice ?? 0) * it.quantity;
        map.set(key, acc);
      }
    }
    return [...map.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit)
      .map((r) => ({ ...r, revenue: +r.revenue.toFixed(2) }));
  }

  /** Full dashboard: spend + campaigns + best sellers for a range. */
  async summary(from?: string, to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const f = from ?? today;
    const t = to ?? today;
    const [spend, campaigns, bestSellers] = await Promise.all([
      this.spendForRange(f, t),
      this.hasCredentials() ? this.campaigns(f, t) : Promise.resolve<CampaignInsight[]>([]),
      this.bestSellers(f, t)
    ]);
    const revenue = campaigns.reduce((s, c) => s + c.purchaseValue, 0);
    const purchases = campaigns.reduce((s, c) => s + c.purchases, 0);
    return {
      from: f,
      to: t,
      configured: this.hasCredentials(),
      currency: 'EUR',
      spend,
      attributedRevenue: +revenue.toFixed(2),
      purchases,
      roas: spend > 0 ? +(revenue / spend).toFixed(2) : null,
      activeCampaigns: campaigns.filter((c) => c.status === 'ACTIVE').length,
      campaigns,
      bestSellers
    };
  }

  // ---------- template (existing campaign structure) ----------
  /** List campaigns shallow, to pick a template from. */
  async campaignTemplates() {
    this.assert();
    const data = await this.graphGet<{ data: any[] }>(`${this.adAccount}/campaigns`, {
      fields: 'name,status,objective',
      limit: '100'
    });
    return (data.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective ?? null
    }));
  }

  /** Read an adset of the template campaign to clone targeting/optimization. */
  private async templateAdSet(campaignId: string) {
    const data = await this.graphGet<{ data: any[] }>(`${campaignId}/adsets`, {
      fields: 'optimization_goal,billing_event,bid_strategy,targeting,promoted_object',
      limit: '1'
    });
    return data.data?.[0] ?? null;
  }

  private async templateObjective(campaignId: string) {
    const data = await this.graphGet<{ objective?: string }>(campaignId, { fields: 'objective' });
    return data.objective ?? null;
  }

  // ---------- create full campaign ----------
  async createCampaign(dto: CreateCampaignDto) {
    this.assert();
    if (!this.pageId) throw new BadRequestException('Falta META_PAGE_ID para crear el creativo');
    if (!dto.imageUrl) throw new BadRequestException('Falta imageUrl del anuncio');

    // 1. resolve template (objective + adset config)
    let objective = dto.objective ?? 'OUTCOME_SALES';
    let optimizationGoal = 'OFFSITE_CONVERSIONS';
    let billingEvent = 'IMPRESSIONS';
    let targeting: any = { geo_locations: { countries: ['ES'] } };
    let promotedObject: any = undefined;

    if (dto.templateCampaignId) {
      const [tplObjective, tplAdSet] = await Promise.all([
        this.templateObjective(dto.templateCampaignId),
        this.templateAdSet(dto.templateCampaignId)
      ]);
      if (tplObjective) objective = tplObjective;
      if (tplAdSet) {
        optimizationGoal = tplAdSet.optimization_goal ?? optimizationGoal;
        billingEvent = tplAdSet.billing_event ?? billingEvent;
        if (tplAdSet.targeting) targeting = tplAdSet.targeting;
        if (tplAdSet.promoted_object) promotedObject = tplAdSet.promoted_object;
      }
    }

    // 2. Campaign (PAUSED for safety)
    const campaign = await this.graphPost<{ id: string }>(`${this.adAccount}/campaigns`, {
      name: dto.name,
      objective,
      status: 'PAUSED',
      special_ad_categories: []
    });

    // 3. AdSet
    const adsetBody: Record<string, any> = {
      name: `${dto.name} — AdSet`,
      campaign_id: campaign.id,
      daily_budget: Math.round(dto.dailyBudget * 100), // cents
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      targeting,
      status: 'PAUSED',
      start_time: dto.startTime ?? new Date().toISOString()
    };
    if (promotedObject) adsetBody.promoted_object = promotedObject;
    const adset = await this.graphPost<{ id: string }>(`${this.adAccount}/adsets`, adsetBody);

    // 4. Creative
    const linkData: Record<string, any> = {
      message: dto.message,
      link: dto.link,
      picture: dto.imageUrl
    };
    if (dto.headline) linkData.name = dto.headline;
    if (dto.description) linkData.description = dto.description;
    if (dto.callToAction) {
      linkData.call_to_action = { type: dto.callToAction, value: { link: dto.link } };
    }
    const objectStorySpec: Record<string, any> = { page_id: this.pageId, link_data: linkData };
    if (this.instagramId) objectStorySpec.instagram_actor_id = this.instagramId;

    const creative = await this.graphPost<{ id: string }>(`${this.adAccount}/adcreatives`, {
      name: `${dto.name} — Creative`,
      object_story_spec: objectStorySpec
    });

    // 5. Ad
    const ad = await this.graphPost<{ id: string }>(`${this.adAccount}/ads`, {
      name: `${dto.name} — Ad`,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED'
    });

    return {
      campaignId: campaign.id,
      adsetId: adset.id,
      creativeId: creative.id,
      adId: ad.id,
      status: 'PAUSED',
      objective,
      note: 'Campaña creada en PAUSA. Revisa y activa desde el Administrador de Anuncios o pulsa Activar.'
    };
  }

  /** Toggle campaign status ACTIVE/PAUSED. */
  async setCampaignStatus(campaignId: string, status: 'ACTIVE' | 'PAUSED') {
    this.assert();
    await this.graphPost(campaignId, { status });
    return { campaignId, status };
  }
}
