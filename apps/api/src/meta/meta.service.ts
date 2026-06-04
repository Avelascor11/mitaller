import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
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

export interface MetaPerformanceInsight {
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

export interface AdSetInsight extends MetaPerformanceInsight {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
}

export interface AdInsight extends MetaPerformanceInsight {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string | null;
  adsetId: string | null;
  creativeId: string | null;
  creativeName: string | null;
  thumbnailUrl: string | null;
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

interface InfluencerDetection {
  isCandidate: boolean;
  score: number;
  reason: string;
  suggestedAction: string;
  tags: string[];
}

interface ImportedConversationMessage {
  text: string;
  senderId?: string;
  senderName?: string;
  createdAt?: Date;
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
  private get webhookVerifyToken() { return this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN') ?? ''; }
  private get appSecret() { return this.config.get<string>('META_APP_SECRET') ?? ''; }

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

  // ---------- Instagram/Messenger webhook ----------
  verifyWebhookChallenge(mode?: string, token?: string) {
    return mode === 'subscribe' && Boolean(this.webhookVerifyToken) && token === this.webhookVerifyToken;
  }

  async handleInstagramWebhook(payload: unknown, signature?: string, rawBody?: Buffer) {
    this.assertWebhookSignature(signature, rawBody);
    const events = this.extractMessagingEvents(payload);
    const processed: Array<{ influencerId: string; igHandle: string; score: number; reason: string; messagePreview: string | null }> = [];
    let ignored = 0;

    for (const event of events) {
      if (!event.senderId) continue;
      const profile = await this.resolveInstagramProfile(event.senderId);
      const igHandle = this.normalizeHandle(profile?.username) ?? `ig_${event.senderId}`;
      const message = event.text ?? event.postbackTitle ?? null;
      const detection = this.detectInfluencerIntent(message);
      const influencer = await this.upsertInfluencerFromWebhook({
        senderId: event.senderId,
        igHandle,
        fullName: profile?.name ?? null,
        message,
        timestamp: event.timestamp,
        detection
      });
      if (!influencer) {
        ignored += 1;
        continue;
      }
      processed.push({
        influencerId: influencer.id,
        igHandle: influencer.igHandle,
        score: influencer.detectionScore,
        reason: influencer.detectionReason ?? detection.reason,
        messagePreview: message ? message.slice(0, 120) : null
      });
    }

    return { ok: true, received: events.length, processed: processed.length, ignored, influencers: processed };
  }

  async importInfluencerConversations(limit = 50) {
    if (!this.token || !this.pageId) {
      throw new BadRequestException('Meta no configurado para leer DMs (faltan META_ACCESS_TOKEN o META_PAGE_ID)');
    }

    const cappedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const conversations = await this.fetchInstagramConversations(cappedLimit);
    const imported: Array<{ influencerId: string; igHandle: string; score: number; reason: string; messagePreview: string | null }> = [];
    let ignored = 0;
    let failed = 0;

    for (const conversation of conversations) {
      const messages = await this.fetchConversationMessages(conversation.id);
      if (!messages.length) {
        failed += 1;
        continue;
      }
      const text = messages.map((message) => message.text).filter(Boolean).join('\n');
      const detection = this.detectInfluencerIntent(text);
      if (!detection.isCandidate) {
        ignored += 1;
        continue;
      }

      const senderId = this.externalConversationSenderId(conversation, messages);
      if (!senderId) {
        ignored += 1;
        continue;
      }

      const profile = await this.resolveInstagramProfile(senderId);
      const participantName = this.externalConversationParticipantName(conversation, senderId);
      const igHandle = this.normalizeHandle(profile?.username)
        ?? this.normalizeHandle(participantName)
        ?? `ig_${senderId}`;
      const latestMessage = messages.find((message) => message.senderId === senderId)?.text ?? messages[0]?.text ?? null;
      const influencer = await this.upsertInfluencerFromWebhook({
        senderId,
        igHandle,
        fullName: profile?.name ?? participantName ?? null,
        message: latestMessage,
        timestamp: messages[0]?.createdAt,
        detection
      });
      if (!influencer) {
        ignored += 1;
        continue;
      }

      imported.push({
        influencerId: influencer.id,
        igHandle: influencer.igHandle,
        score: influencer.detectionScore,
        reason: influencer.detectionReason ?? detection.reason,
        messagePreview: latestMessage ? latestMessage.slice(0, 120) : null
      });
    }

    return { ok: true, checked: conversations.length, imported: imported.length, ignored, failed, influencers: imported };
  }

  private async fetchInstagramConversations(limit: number) {
    const response = await this.graphGet<{ data?: any[] }>(`${this.pageId}/conversations`, {
      platform: 'instagram',
      limit: String(limit),
      fields: 'id,participants,updated_time'
    });
    return Array.isArray(response.data) ? response.data : [];
  }

  private async fetchConversationMessages(conversationId?: string): Promise<ImportedConversationMessage[]> {
    if (!conversationId) return [];
    try {
      const response = await this.graphGet<{ data?: any[] }>(`${conversationId}/messages`, {
        limit: '8',
        fields: 'message,from,created_time'
      });
      return this.mapConversationMessages(response.data ?? []);
    } catch (error) {
      this.logger.warn(`No se pudieron leer mensajes de conversacion ${conversationId}: ${(error as Error).message}`);
      return [];
    }
  }

  private extractConversationMessages(conversation: any): ImportedConversationMessage[] {
    const rawMessages = Array.isArray(conversation?.messages?.data) ? conversation.messages.data : [];
    return this.mapConversationMessages(rawMessages);
  }

  private mapConversationMessages(rawMessages: any[]): ImportedConversationMessage[] {
    return rawMessages
      .map((message: any) => ({
        text: typeof message?.message === 'string' ? message.message : '',
        senderId: message?.from?.id ? String(message.from.id) : undefined,
        senderName: typeof message?.from?.name === 'string' ? message.from.name : undefined,
        createdAt: message?.created_time ? new Date(message.created_time) : undefined
      }))
      .filter((message: ImportedConversationMessage) => message.text || message.senderId);
  }

  private externalConversationSenderId(conversation: any, messages: ImportedConversationMessage[]) {
    const ownIds = new Set([this.pageId, this.instagramId].filter(Boolean));
    const fromMessage = messages.find((message) => message.senderId && !ownIds.has(message.senderId))?.senderId;
    if (fromMessage) return fromMessage;
    const participants = Array.isArray(conversation?.participants?.data) ? conversation.participants.data : [];
    return participants.map((item: any) => String(item?.id ?? '')).find((id: string) => id && !ownIds.has(id)) ?? null;
  }

  private externalConversationParticipantName(conversation: any, senderId: string) {
    const participants = Array.isArray(conversation?.participants?.data) ? conversation.participants.data : [];
    const participant = participants.find((item: any) => String(item?.id ?? '') === senderId);
    return typeof participant?.name === 'string' ? participant.name : null;
  }

  private assertWebhookSignature(signature?: string, rawBody?: Buffer) {
    if (!this.appSecret) return;
    if (!signature || !rawBody) throw new UnauthorizedException('Firma webhook Meta ausente');
    const expected = `sha256=${createHmac('sha256', this.appSecret).update(rawBody).digest('hex')}`;
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('Firma webhook Meta no valida');
    }
  }

  private extractMessagingEvents(payload: unknown) {
    const body = payload as any;
    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
    const events: Array<{ senderId: string; text?: string; postbackTitle?: string; timestamp?: Date }> = [];

    for (const entry of entries) {
      const messaging: any[] = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const item of messaging) {
        const senderId = item?.sender?.id;
        if (!senderId) continue;
        const text = typeof item?.message?.text === 'string' ? item.message.text : undefined;
        const postbackTitle = typeof item?.postback?.title === 'string' ? item.postback.title : undefined;
        if (!text && !postbackTitle && item?.message == null && item?.postback == null) continue;
        events.push({
          senderId: String(senderId),
          text,
          postbackTitle,
          timestamp: Number.isFinite(Number(item?.timestamp)) ? new Date(Number(item.timestamp)) : undefined
        });
      }
    }

    return events;
  }

  private async resolveInstagramProfile(senderId: string): Promise<{ username?: string; name?: string } | null> {
    if (!this.token) return null;
    try {
      return await this.graphGet<{ username?: string; name?: string }>(senderId, { fields: 'username,name' });
    } catch (error) {
      this.logger.warn(`No se pudo resolver perfil Instagram ${senderId}: ${(error as Error).message}`);
      return null;
    }
  }

  private async upsertInfluencerFromWebhook(input: {
    senderId: string;
    igHandle: string;
    fullName: string | null;
    message: string | null;
    timestamp?: Date;
    detection: InfluencerDetection;
  }) {
    const existing = await this.prisma.influencer.findFirst({
      where: {
        OR: [
          { manychatId: input.senderId },
          { igHandle: input.igHandle }
        ]
      }
    });
    if (!existing && !input.detection.isCandidate) return null;
    const stage = existing?.stage && !['PROSPECT', 'CONTACTED'].includes(existing.stage) ? existing.stage : 'CONTACTED';
    const tags = Array.from(new Set([...(existing?.tags ?? []), 'instagram-webhook', ...input.detection.tags]));
    const firstDetectedAt = existing?.firstDetectedAt ?? (input.detection.isCandidate ? input.timestamp ?? new Date() : undefined);
    const data = {
      manychatId: input.senderId,
      fullName: input.fullName ?? existing?.fullName ?? undefined,
      stage,
      tags,
      lastMessage: input.message ?? existing?.lastMessage ?? undefined,
      lastMessageAt: input.timestamp ?? new Date(),
      source: existing?.source ?? 'instagram_dm',
      detectionScore: Math.max(existing?.detectionScore ?? 0, input.detection.score),
      detectionReason: input.detection.reason || existing?.detectionReason || undefined,
      suggestedAction: input.detection.suggestedAction || existing?.suggestedAction || undefined,
      firstDetectedAt,
      lastInboundAt: input.timestamp ?? new Date()
    };

    if (existing) {
      return this.prisma.influencer.update({
        where: { id: existing.id },
        data
      });
    }

    return this.prisma.influencer.create({
      data: {
        igHandle: input.igHandle,
        ...data
      }
    });
  }

  private detectInfluencerIntent(message?: string | null): InfluencerDetection {
    const text = (message ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (!text.trim()) {
      return { isCandidate: false, score: 0, reason: '', suggestedAction: '', tags: [] };
    }

    const strong = [
      ['colaboracion', 'menciona colaboracion'],
      ['colaborar', 'pide colaborar'],
      ['collab', 'menciona collab'],
      ['influencer', 'se identifica como influencer'],
      ['creador', 'se identifica como creador'],
      ['creadora', 'se identifica como creadora'],
      ['ugc', 'menciona UGC'],
      ['media kit', 'menciona media kit'],
      ['embajador', 'menciona embajador'],
      ['embajadora', 'menciona embajadora'],
      ['afiliado', 'menciona afiliado'],
      ['affiliate', 'menciona afiliado'],
      ['canje', 'pide canje'],
      ['gifted', 'pide producto gifted']
    ];
    const medium = [
      ['reel', 'propone reel'],
      ['reels', 'propone reels'],
      ['tiktok', 'menciona TikTok'],
      ['video', 'menciona video'],
      ['contenido', 'menciona contenido'],
      ['seguidores', 'menciona seguidores'],
      ['audiencia', 'menciona audiencia'],
      ['promocion', 'menciona promocion'],
      ['promocionar', 'propone promocionar'],
      ['unboxing', 'propone unboxing'],
      ['review', 'propone review'],
      ['resena', 'propone resena']
    ];
    const productAsk = [
      ['me mandais ropa', 'pide producto para contenido'],
      ['me mandas ropa', 'pide producto para contenido'],
      ['enviarme ropa', 'pide producto para contenido'],
      ['mandarme ropa', 'pide producto para contenido'],
      ['me enviais', 'pide envio de producto'],
      ['me envias', 'pide envio de producto']
    ];
    const customerSupport = ['pedido', 'envio', 'seguimiento', 'devolucion', 'cambio de talla', 'talla', 'no me llega', 'compra'];

    let score = 0;
    const reasons: string[] = [];
    const tags = new Set<string>();
    for (const [keyword, reason] of strong) {
      if (text.includes(keyword)) {
        score += 35;
        reasons.push(reason);
        tags.add('collab');
      }
    }
    for (const [keyword, reason] of medium) {
      if (text.includes(keyword)) {
        score += 18;
        reasons.push(reason);
        tags.add('contenido');
      }
    }
    for (const [keyword, reason] of productAsk) {
      if (text.includes(keyword)) {
        score += 22;
        reasons.push(reason);
        tags.add('producto');
      }
    }
    const followerMatch = text.match(/(\d{2,6})\s*(k|mil)?\s*(seguidores|followers|subs)/);
    if (followerMatch) {
      score += followerMatch[2] ? 28 : 16;
      reasons.push('menciona tamano de audiencia');
      tags.add('audiencia');
    }
    if (customerSupport.some((keyword) => text.includes(keyword)) && score < 45) {
      score -= 18;
      reasons.push('parece soporte/cliente normal');
    }
    score = Math.max(0, Math.min(100, score));

    const isCandidate = score >= 40;
    return {
      isCandidate,
      score,
      reason: reasons.slice(0, 4).join(' · '),
      suggestedAction: isCandidate ? this.suggestInfluencerAction(score, tags) : '',
      tags: [...tags]
    };
  }

  private suggestInfluencerAction(score: number, tags: Set<string>) {
    if (score >= 75) return 'Revisar perfil y responder hoy con propuesta de colaboracion';
    if (tags.has('producto')) return 'Pedir metricas/perfil antes de enviar producto';
    if (tags.has('contenido')) return 'Pedir ejemplos de contenido y condiciones';
    return 'Revisar conversacion y decidir si interesa';
  }

  private normalizeHandle(value?: string | null) {
    const cleaned = value?.trim().replace(/^@+/, '').toLowerCase();
    return cleaned || null;
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

  async campaignDetail(campaignId: string, from: string, to: string) {
    this.assert();
    const time = JSON.stringify({ since: from, until: to });
    const [campaignRaw, adsetsRaw, adsRaw] = await Promise.all([
      this.graphGet<any>(campaignId, {
        fields: [
          'name',
          'status',
          'effective_status',
          'objective',
          'created_time',
          'updated_time',
          `insights.time_range(${time}){spend,impressions,clicks,ctr,cpc,reach,actions,action_values}`
        ].join(',')
      }),
      this.graphGet<{ data: any[] }>(`${campaignId}/adsets`, {
        fields: [
          'name',
          'status',
          'effective_status',
          'daily_budget',
          'lifetime_budget',
          'optimization_goal',
          'billing_event',
          `insights.time_range(${time}){spend,impressions,clicks,ctr,cpc,reach,actions,action_values}`
        ].join(','),
        limit: '100'
      }),
      this.graphGet<{ data: any[] }>(`${campaignId}/ads`, {
        fields: [
          'name',
          'status',
          'effective_status',
          'adset_id',
          'creative{id,name,thumbnail_url}',
          `insights.time_range(${time}){spend,impressions,clicks,ctr,cpc,reach,actions,action_values}`
        ].join(','),
        limit: '100'
      })
    ]);

    return {
      from,
      to,
      campaign: this.mapCampaign(campaignRaw),
      createdTime: campaignRaw.created_time ?? null,
      updatedTime: campaignRaw.updated_time ?? null,
      effectiveStatus: campaignRaw.effective_status ?? null,
      adsets: (adsetsRaw.data ?? []).map((adset) => this.mapAdSet(adset)),
      ads: (adsRaw.data ?? []).map((ad) => this.mapAd(ad))
    };
  }

  private mapCampaign(c: any): CampaignInsight {
    const perf = this.mapPerformance(c.insights?.data?.[0]);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective ?? null,
      ...perf
    };
  }

  private mapAdSet(adset: any): AdSetInsight {
    return {
      id: adset.id,
      name: adset.name,
      status: adset.status,
      effectiveStatus: adset.effective_status ?? null,
      dailyBudget: adset.daily_budget != null ? +(Number(adset.daily_budget) / 100).toFixed(2) : null,
      lifetimeBudget: adset.lifetime_budget != null ? +(Number(adset.lifetime_budget) / 100).toFixed(2) : null,
      optimizationGoal: adset.optimization_goal ?? null,
      billingEvent: adset.billing_event ?? null,
      ...this.mapPerformance(adset.insights?.data?.[0])
    };
  }

  private mapAd(ad: any): AdInsight {
    return {
      id: ad.id,
      name: ad.name,
      status: ad.status,
      effectiveStatus: ad.effective_status ?? null,
      adsetId: ad.adset_id ?? null,
      creativeId: ad.creative?.id ?? null,
      creativeName: ad.creative?.name ?? null,
      thumbnailUrl: ad.creative?.thumbnail_url ?? null,
      ...this.mapPerformance(ad.insights?.data?.[0])
    };
  }

  private mapPerformance(ins: any): MetaPerformanceInsight {
    const actions: any[] = ins?.actions ?? [];
    const values: any[] = ins?.action_values ?? [];
    const purchaseAction = actions.find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
    const purchaseValue = values.find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
    const spend = Number(ins?.spend ?? 0);
    const pv = Number(purchaseValue?.value ?? 0);
    return {
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
