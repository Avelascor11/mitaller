import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { KlaviyoService } from '../klaviyo/klaviyo.service';
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

export interface MetaRecommendation {
  id: string;
  targetType: 'ACCOUNT' | 'CAMPAIGN' | 'ADSET' | 'AD';
  targetId: string | null;
  targetName: string;
  severity: 'SCALE' | 'PAUSE' | 'WATCH' | 'FIX' | 'INFO';
  title: string;
  reason: string;
  action: string;
  solution?: string;
  metricLabel: string;
  priority: number;
  currentDailyBudget: number | null;
  suggestedDailyBudget: number | null;
}

export interface MetaRecommendationPreview {
  canApply: boolean;
  targetType: 'CAMPAIGN' | 'ADSET' | 'AD';
  targetId: string;
  severity: 'SCALE' | 'PAUSE' | 'FIX';
  currentDailyBudget: number | null;
  suggestedDailyBudget: number | null;
  currentStatus: string | null;
  nextStatus: string | null;
  impact: string;
  warnings: string[];
}

export interface MetaDailyPlanItem {
  recommendation: MetaRecommendation;
  preview: MetaRecommendationPreview | null;
  canApply: boolean;
  skipReason: string | null;
}

export interface ApplyMetaRecommendationDto {
  targetType: 'CAMPAIGN' | 'ADSET' | 'AD';
  targetId: string;
  severity: 'SCALE' | 'PAUSE' | 'WATCH' | 'FIX' | 'INFO';
  suggestedDailyBudget?: number | null;
}

export interface ApplyMetaDailyPlanDto {
  items: ApplyMetaRecommendationDto[];
}

export interface MetaAdvisorQuestionDto {
  question: string;
  from?: string;
  to?: string;
}

export interface MetaAdvisorActionSuggestion {
  id: string;
  label: string;
  detail: string;
  targetType: 'CAMPAIGN' | 'ADSET' | 'AD';
  targetId: string;
  severity: 'SCALE' | 'PAUSE' | 'FIX';
  suggestedDailyBudget?: number | null;
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

interface ImportInfluencerConversationOptions {
  limit?: number;
  includeWeak?: boolean;
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
    private readonly prisma: PrismaService,
    private readonly klaviyo: KlaviyoService
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
  private async graphGet<T>(path: string, params: Record<string, string> = {}, timeoutMs = this.graphTimeoutMs()): Promise<T> {
    const url = new URL(`${GRAPH}/${this.version}/${path}`);
    url.searchParams.set('access_token', this.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      const json = await res.json();
      if (!res.ok) {
        this.logger.error(`Meta GET ${path} failed: ${JSON.stringify(json?.error ?? json)}`);
        throw new BadRequestException(json?.error?.message ?? 'Error en la API de Meta');
      }
      return json as T;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error && error.name === 'AbortError'
        ? `Meta API timeout leyendo ${path}`
        : `Meta API no disponible: ${error instanceof Error ? error.message : String(error)}`;
      throw new BadRequestException(message);
    } finally {
      clearTimeout(timeout);
    }
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

  private graphTimeoutMs() {
    const value = Number(this.config.get<string>('META_GRAPH_TIMEOUT_MS') ?? 10000);
    return Number.isFinite(value) ? Math.max(1500, value) : 10000;
  }

  private instagramConversationTimeoutMs() {
    const value = Number(this.config.get<string>('META_INSTAGRAM_CONVERSATION_TIMEOUT_MS') ?? 30000);
    return Number.isFinite(value) ? Math.max(5000, value) : 30000;
  }

  private instagramMessageTimeoutMs() {
    const value = Number(this.config.get<string>('META_INSTAGRAM_MESSAGE_TIMEOUT_MS') ?? 12000);
    return Number.isFinite(value) ? Math.max(3000, value) : 12000;
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

  async influencerConnectionStatus() {
    const configured = {
      token: Boolean(this.token),
      pageId: Boolean(this.pageId),
      instagramId: Boolean(this.instagramId),
      webhookVerifyToken: Boolean(this.webhookVerifyToken),
      appSecret: Boolean(this.appSecret)
    };
    if (!this.token || !this.pageId) {
      return { ok: false, configured, message: 'Faltan META_ACCESS_TOKEN o META_PAGE_ID' };
    }
    try {
      const [me, page] = await Promise.all([
        this.graphGet<{ id?: string; name?: string }>('me', { fields: 'id,name' }, 5000),
        this.graphGet<{ id?: string; name?: string; instagram_business_account?: { id?: string } }>(
          this.pageId,
          { fields: 'id,name,instagram_business_account' },
          5000
        )
      ]);
      return {
        ok: true,
        configured,
        me,
        page: { id: page.id, name: page.name, instagramBusinessAccountId: page.instagram_business_account?.id ?? null },
        message: 'Meta conectado'
      };
    } catch (error) {
      return {
        ok: false,
        configured,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async importInfluencerConversations(input: number | ImportInfluencerConversationOptions = 10) {
    if (!this.token || !this.pageId) {
      throw new BadRequestException('Meta no configurado para leer DMs (faltan META_ACCESS_TOKEN o META_PAGE_ID)');
    }

    const options = typeof input === 'number' ? { limit: input } : input;
    const includeWeak = Boolean(options.includeWeak);
    const minReviewScore = includeWeak ? 8 : 40;
    const cappedLimit = Math.max(1, Math.min(Number(options.limit) || 10, 25));
    const conversationsResult = await this.fetchInstagramConversationsSafely(cappedLimit);
    if (!conversationsResult.ok) {
      return {
        ok: false,
        checked: 0,
        imported: 0,
        ignored: 0,
        failed: 1,
        message: conversationsResult.message,
        influencers: []
      };
    }
    const conversations = conversationsResult.conversations;
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
      if (!detection.isCandidate && (!includeWeak || detection.score < minReviewScore)) {
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
      const effectiveDetection = detection.isCandidate ? detection : {
        isCandidate: true,
        score: Math.max(detection.score, minReviewScore),
        reason: detection.reason || 'Conversacion importada para revisar manualmente',
        suggestedAction: 'Revisar conversacion y decidir si interesa',
        tags: ['revision']
      };
      const influencer = await this.upsertInfluencerFromWebhook({
        senderId,
        igHandle,
        fullName: profile?.name ?? participantName ?? null,
        message: latestMessage,
        timestamp: messages[0]?.createdAt,
        detection: effectiveDetection
      });
      if (!influencer) {
        ignored += 1;
        continue;
      }

      imported.push({
        influencerId: influencer.id,
        igHandle: influencer.igHandle,
        score: influencer.detectionScore,
        reason: influencer.detectionReason ?? effectiveDetection.reason,
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
    }, this.instagramConversationTimeoutMs());
    return Array.isArray(response.data) ? response.data : [];
  }

  private async fetchInstagramConversationsSafely(limit: number): Promise<
    { ok: true; conversations: any[] } | { ok: false; message: string }
  > {
    try {
      return { ok: true, conversations: await this.fetchInstagramConversations(limit) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudieron buscar conversaciones de Instagram: ${message}`);
      return {
        ok: false,
        message: 'Meta ha tardado demasiado leyendo los DMs. Los DMs nuevos entraran por webhook; prueba otra vez en unos minutos o baja el limite de busqueda.'
      };
    }
  }

  private async fetchConversationMessages(conversationId?: string): Promise<ImportedConversationMessage[]> {
    if (!conversationId) return [];
    try {
      const response = await this.graphGet<{ data?: any[] }>(`${conversationId}/messages`, {
        limit: '8',
        fields: 'message,from,created_time'
      }, this.instagramMessageTimeoutMs());
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
    const stage = existing?.stage && !['PROSPECT', 'CONTACTED'].includes(existing.stage)
      ? existing.stage
      : input.detection.tags.includes('revision') ? 'PROSPECT' : 'CONTACTED';
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

  async billingStatus() {
    if (!this.hasCredentials()) {
      return {
        configured: false,
        currency: 'EUR',
        balanceDue: 0,
        amountSpent: 0,
        spendCap: null,
        paymentLimit: this.metaPaymentLimit(),
        warningThreshold: this.metaPaymentWarningThreshold(),
        status: 'INFO',
        headline: 'Meta Ads no configurado',
        action: 'Configura META_ACCESS_TOKEN y META_AD_ACCOUNT_ID para ver el saldo pendiente.'
      };
    }
    const account = await this.graphGet<{
      id?: string;
      name?: string;
      account_status?: number;
      currency?: string;
      balance?: string | number;
      amount_spent?: string | number;
      spend_cap?: string | number;
    }>(this.adAccount, {
      fields: 'id,name,account_status,currency,balance,amount_spent,spend_cap'
    });
    const balanceDue = this.parseMetaMoney(account.balance);
    const amountSpent = this.parseMetaMoney(account.amount_spent);
    const spendCap = account.spend_cap == null ? null : this.parseMetaMoney(account.spend_cap);
    const paymentLimit = this.metaPaymentLimit();
    const warningThreshold = this.metaPaymentWarningThreshold();
    const status = balanceDue >= paymentLimit ? 'BAD' : balanceDue >= warningThreshold ? 'WATCH' : balanceDue > 0 ? 'GOOD' : 'INFO';
    return {
      configured: true,
      accountId: account.id ?? this.adAccount,
      accountName: account.name ?? 'Meta Ads',
      accountStatus: account.account_status ?? null,
      currency: account.currency ?? 'EUR',
      balanceDue,
      amountSpent,
      spendCap,
      paymentLimit,
      warningThreshold,
      status,
      headline: this.billingHeadline(status, balanceDue, paymentLimit),
      action: this.billingAction(status)
    };
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
  // ---------- Autopilot ----------
  private cfgNum(key: string, fallback: number) {
    const n = Number((this.config.get<string>(key) ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  async getAutopilotMode(): Promise<string> {
    try {
      const cfg = await this.prisma.autopilotConfig.findUnique({ where: { id: 'singleton' } });
      if (cfg?.mode) return cfg.mode;
    } catch { /* table may not exist yet */ }
    return (this.config.get<string>('META_AUTOPILOT_MODE') ?? 'dry').toLowerCase();
  }

  async setAutopilotMode(mode: string) {
    const m = ['off', 'dry', 'live'].includes(mode) ? mode : 'dry';
    await this.prisma.autopilotConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton', mode: m }, update: { mode: m }
    }).catch(() => undefined);
    // When switching ON, run a real pass immediately so changes apply now (not just at the daily cron).
    let appliedNow: { applied: number; actions: any[] } | undefined;
    if (m === 'live' && this.hasCredentials()) {
      try {
        const run = await this.autopilotRun(true);
        appliedNow = { applied: run.actions.filter((a: any) => a.applied).length, actions: run.actions };
      } catch { /* ignore */ }
    }
    return { mode: m, appliedNow };
  }

  /** Last autopilot run from the activity log, so the app can show what was applied + when. */
  async autopilotLastRun() {
    try {
      const log = await this.prisma.activityLog.findFirst({
        where: { entityType: 'MetaAutopilot', action: { in: ['AUTOPILOT_APPLIED', 'AUTOPILOT_PAUSE_WEAK'] } },
        orderBy: { createdAt: 'desc' }
      });
      if (!log) return { ranAt: null, action: null, message: null, meta: null };
      return { ranAt: log.createdAt, action: log.action, message: log.message, meta: log.metadataJson };
    } catch {
      return { ranAt: null, action: null, message: null, meta: null };
    }
  }

  /** Pause all underperforming active adsets (the "weak" ones the autopilot only advises about). */
  async pauseWeakAdsets() {
    this.assert();
    const plan = await this.autopilotRun(false);
    const weak = (plan.advice as any[]).filter((a) => a.weak && a.adsetId);
    const paused: any[] = [];
    for (const w of weak) {
      try {
        await this.graphPost(w.adsetId, { status: 'PAUSED' });
        paused.push({ adsetId: w.adsetId, name: w.name, reason: w.msg });
      } catch (e) {
        paused.push({ adsetId: w.adsetId, name: w.name, error: (e as Error).message });
      }
    }
    await this.prisma.activityLog.create({
      data: {
        entityType: 'MetaAutopilot', entityId: 'account', action: 'AUTOPILOT_PAUSE_WEAK',
        message: `Pausados ${paused.filter((p) => !p.error).length} anuncios flojos`,
        metadataJson: { paused } as any
      }
    }).catch(() => undefined);
    return { pausedCount: paused.filter((p) => !p.error).length, paused };
  }

  @Cron('0 8 * * *', { timeZone: 'Europe/Madrid' })
  async autopilotCron() {
    const mode = await this.getAutopilotMode();
    if (mode === 'off' || !this.hasCredentials()) return;
    try {
      const r = await this.autopilotRun(mode === 'live');
      this.logger.log(`Autopilot (${mode}): ${r.actions.length} subidas, ${r.advice.length} avisos`);
      if (r.alerts.length) await this.sendAutopilotAlert(r.alerts);
    } catch (e) {
      this.logger.warn(`Autopilot failed: ${(e as Error).message}`);
      await this.sendAutopilotAlert([`El autopilot falló: ${(e as Error).message}`]);
    }
  }

  private async sendAutopilotAlert(alerts: string[]) {
    const email = this.config.get<string>('AUTOPILOT_ALERT_EMAIL') ?? 'angel@speedwear.es';
    try {
      await this.klaviyo.trackAutopilotAlert({
        email,
        summary: `Meta Autopilot: ${alerts.length} cosa(s) a revisar`,
        details: alerts.slice(0, 10).join(' | ')
      });
    } catch (e) {
      this.logger.warn(`Autopilot alert email failed: ${(e as Error).message}`);
    }
  }

  /** Evaluate active adsets and scale budgets of profitable ones within the daily ceiling. */
  async autopilotRun(apply: boolean) {
    this.assert();
    // Daily account ceiling: 0 (or unset) = no ceiling, scale freely (+step/day on winners only).
    const ceilingRaw = Number((this.config.get<string>('META_AUTOPILOT_MAX_DAILY') ?? '0').replace(',', '.'));
    const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0 ? ceilingRaw : Infinity;
    const minRoas = this.cfgNum('META_AUTOPILOT_MIN_ROAS', 1.5);
    const step = this.cfgNum('META_AUTOPILOT_STEP', 0.15);
    // Evaluate by recent DAILY performance, not a 7-day total. Default: last full day (yesterday).
    const windowDays = Math.max(1, this.cfgNum('META_AUTOPILOT_WINDOW_DAYS', 1));
    const to = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);

    const activeCampaigns = (await this.campaigns(from, to)).filter((c) => c.status === 'ACTIVE');
    const adsets: Array<AdSetInsight & { campaignName: string }> = [];
    for (const c of activeCampaigns) {
      try {
        const detail = await this.campaignDetail(c.id, from, to);
        for (const a of detail.adsets) {
          if (a.status === 'ACTIVE' && a.dailyBudget != null) adsets.push({ ...a, campaignName: c.name });
        }
      } catch { /* skip campaign */ }
    }

    let totalDaily = +adsets.reduce((s, a) => s + (a.dailyBudget ?? 0), 0).toFixed(2);
    const actions: any[] = [];
    const advice: any[] = [];

    for (const a of adsets) {
      const budget = a.dailyBudget ?? 0;
      if (a.purchases >= 2 && (a.roas ?? 0) >= minRoas) {
        const room = +(ceiling - totalDaily).toFixed(2);
        if (room <= 0.5) { advice.push({ name: a.name, campaign: a.campaignName, msg: `Subiría presupuesto pero el tope diario (${ceiling}€) está al máximo.` }); continue; }
        const target = +(budget * (1 + step)).toFixed(2);
        const newBudget = +Math.min(target, budget + room).toFixed(2);
        if (newBudget <= budget + 0.01) continue;
        actions.push({ type: 'SCALE', adsetId: a.id, name: a.name, campaign: a.campaignName, from: budget, to: newBudget, roas: a.roas, purchases: a.purchases });
        totalDaily = +(totalDaily - budget + newBudget).toFixed(2);
      } else if (a.spend >= 20 && a.purchases === 0) {
        advice.push({ adsetId: a.id, name: a.name, campaign: a.campaignName, severity: 'PAUSE', weak: true, msg: `Gasta ${a.spend.toFixed(0)}€ y 0 ventas — considera pausar.` });
      } else if (a.spend >= 15 && (a.roas ?? 0) > 0 && (a.roas ?? 0) < 1) {
        advice.push({ adsetId: a.id, name: a.name, campaign: a.campaignName, severity: 'FIX', weak: true, msg: `ROAS ${a.roas?.toFixed(2)}x (pierde dinero) — revisa o pausa.` });
      }
    }

    if (apply) {
      for (const act of actions) {
        try { await this.graphPost(act.adsetId, { daily_budget: Math.round(act.to * 100) }); act.applied = true; }
        catch (e) { act.applied = false; act.error = (e as Error).message; }
      }
    }

    await this.prisma.activityLog.create({
      data: {
        entityType: 'MetaAutopilot', entityId: 'account',
        action: apply ? 'AUTOPILOT_APPLIED' : 'AUTOPILOT_DRY',
        message: `${actions.length} subidas · ${advice.length} avisos · total diario ${totalDaily}€/${ceiling}€`,
        metadataJson: { actions, advice, totalDaily, ceiling } as any
      }
    }).catch(() => undefined);

    // Projection: what enabling the autopilot would do (based on the planned raises + their ROAS).
    const extraDailySpend = +actions.reduce((s, a) => s + (a.to - a.from), 0).toFixed(2);
    const extraDailyRevenue = +actions.reduce((s, a) => s + (a.to - a.from) * (a.roas ?? 0), 0).toFixed(2);
    const projection = {
      raises: actions.length,
      extraDailySpend,
      extraDailyRevenue,
      extraDailyProfit: +(extraDailyRevenue - extraDailySpend).toFixed(2),
      monthlyExtraSpend: +(extraDailySpend * 30).toFixed(2),
      monthlyExtraRevenue: +(extraDailyRevenue * 30).toFixed(2),
      monthlyExtraProfit: +((extraDailyRevenue - extraDailySpend) * 30).toFixed(2),
      avgRoas: extraDailySpend > 0 ? +(extraDailyRevenue / extraDailySpend).toFixed(2) : null
    };

    // Alerts: failed applies + money-losing adsets → things that need the owner's attention.
    const alerts: string[] = [];
    for (const a of actions) if (a.applied === false) alerts.push(`No se pudo subir ${a.name}: ${a.error ?? 'error'}`);
    for (const w of advice) if ((w as any).weak) alerts.push(`${w.name}: ${w.msg}`);

    return { mode: apply ? 'live' : 'dry', ranAt: new Date().toISOString(), windowFrom: from, windowTo: to, ceiling, minRoas, step, totalDailyAfter: totalDaily, actions, advice, projection, alerts };
  }

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
      ads: (adsRaw.data ?? []).map((ad) => this.mapAd(ad)),
      recommendations: this.buildDetailRecommendations(
        this.mapCampaign(campaignRaw),
        (adsetsRaw.data ?? []).map((adset) => this.mapAdSet(adset)),
        (adsRaw.data ?? []).map((ad) => this.mapAd(ad))
      )
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
    const recommendations = this.applyWeekendRecommendationPolicy(
      this.buildCampaignRecommendations(campaigns, spend > 0 ? revenue / spend : null),
      this.rangeTouchesWeekend(f, t)
    );
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
      recommendations,
      bestSellers
    };
  }

  async advisor(body: MetaAdvisorQuestionDto) {
    const question = body?.question?.trim();
    if (!question) throw new BadRequestException('Escribe una pregunta para el agente de Meta Ads');

    const today = new Date().toISOString().slice(0, 10);
    const f = body.from ?? today;
    const t = body.to ?? today;
    const [summary, weekendCash, billing] = await Promise.all([
      this.summary(f, t),
      this.weekendCash(f, t).catch(() => null),
      this.billingStatus().catch(() => null)
    ]);

    const campaigns = summary.campaigns ?? [];
    const active = campaigns.filter((campaign) => campaign.status === 'ACTIVE');
    const risky = active
      .filter((campaign) => campaign.spend >= 8 && (campaign.purchases === 0 || (campaign.roas ?? 0) < 1.1))
      .sort((a, b) => b.spend - a.spend);
    const winners = active
      .filter((campaign) => campaign.purchases >= 2 && (campaign.roas ?? 0) >= 2.2)
      .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
    const intent = this.advisorIntent(question);
    const topRecommendations = summary.recommendations ?? [];

    const context = {
      summary,
      weekendCash,
      billing,
      risky,
      winners,
      topRecommendations
    };
    const response = this.buildAdvisorResponse(intent, question, context);

    const answer = {
      from: f,
      to: t,
      question,
      headline: response.headline,
      answer: response.answer,
      confidence: response.confidence,
      nextActions: response.nextActions,
      actionSuggestions: this.advisorActionSuggestions(intent, topRecommendations, risky, winners),
      metrics: [
        { label: 'Gasto', value: this.money(summary.spend), tone: 'red' },
        { label: 'Ventas atrib.', value: this.money(summary.attributedRevenue), tone: 'green' },
        { label: 'ROAS', value: summary.roas == null ? '—' : `${summary.roas.toFixed(2)}x`, tone: (summary.roas ?? 0) >= 2 ? 'green' : 'amber' },
        { label: 'Compras', value: String(summary.purchases), tone: 'blue' }
      ],
      campaigns: [...risky.slice(0, 4), ...winners.slice(0, 3)]
        .filter((campaign, index, list) => list.findIndex((item) => item.id === campaign.id) === index)
        .map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          spend: campaign.spend,
          purchases: campaign.purchases,
          roas: campaign.roas,
          ctr: campaign.ctr,
          advice: this.advisorCampaignAdvice(campaign)
        })),
      suggestedQuestions: [
        '¿Qué pauso hoy?',
        '¿Puedo escalar algo?',
        '¿Cómo protejo caja este finde?',
        '¿Pago Meta ahora?'
      ]
    };
    await this.saveAdvisorExchange(question, answer);
    return answer;
  }

  async advisorChat(limit = 20) {
    await this.ensureMetaAdvisorChatTable();
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      id: string;
      role: string;
      text: string;
      answer_json: unknown | null;
      created_at: Date;
    }>>(
      `select id, role, text, answer_json, created_at
       from meta_advisor_chat_messages
       order by created_at desc
       limit ${Math.max(1, Math.min(80, Number(limit) || 20))}`
    );
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      answer: row.answer_json,
      createdAt: row.created_at.toISOString()
    }));
  }

  async weekendCash(from?: string, to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const f = from ?? today;
    const t = to ?? today;
    const [spend, salesRevenue, campaigns] = await Promise.all([
      this.spendForRange(f, t),
      this.salesRevenueForRange(f, t),
      this.hasCredentials() ? this.campaigns(f, t) : Promise.resolve<CampaignInsight[]>([])
    ]);
    const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'ACTIVE');
    const isWeekend = this.rangeTouchesWeekend(f, t);
    const pendingShopifyPayout = isWeekend ? salesRevenue : 0;
    const spendToSalesPct = salesRevenue > 0 ? (spend / salesRevenue) * 100 : null;
    const maxWeekendSpend = this.maxWeekendAdSpend(salesRevenue);
    const remainingWeekendSpend = Math.max(0, maxWeekendSpend - spend);
    const status = this.weekendCashStatus(isWeekend, spend, salesRevenue, maxWeekendSpend);
    const recommendation = this.weekendCashRecommendation(status, isWeekend, spend, salesRevenue, maxWeekendSpend);

    return {
      from: f,
      to: t,
      currency: 'EUR',
      isWeekend,
      status,
      headline: recommendation.headline,
      spend,
      salesRevenue,
      pendingShopifyPayout,
      maxWeekendSpend,
      remainingWeekendSpend: +remainingWeekendSpend.toFixed(2),
      spendToSalesPct: spendToSalesPct == null ? null : +spendToSalesPct.toFixed(1),
      activeCampaigns: activeCampaigns.length,
      shouldScale: status === 'GOOD' && !isWeekend,
      actions: recommendation.actions
    };
  }

  private async salesRevenueForRange(from: string, to: string) {
    const start = new Date(`${from}T00:00:00.000`);
    const end = new Date(`${to}T23:59:59.999`);
    const orders = await this.prisma.order.findMany({
      where: {
        orderedAt: { gte: start, lte: end },
        operationalStatus: { not: 'CANCELLED' }
      },
      select: { totalPrice: true, subtotalPrice: true, totalShipping: true, totalDiscount: true, items: { select: { unitPrice: true, quantity: true } } }
    });
    return +orders.reduce((sum, order) => {
      if (order.totalPrice != null) return sum + order.totalPrice;
      const itemRevenue = order.subtotalPrice
        ?? order.items.reduce((lineSum, item) => lineSum + (item.unitPrice ?? 0) * item.quantity, 0);
      return sum + itemRevenue + (order.totalShipping ?? 0) - (order.totalDiscount ?? 0);
    }, 0).toFixed(2);
  }

  private rangeTouchesWeekend(from: string, to: string) {
    const start = new Date(`${from}T12:00:00.000Z`);
    const end = new Date(`${to}T12:00:00.000Z`);
    for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      const weekDay = day.getUTCDay();
      if (weekDay === 0 || weekDay === 6) return true;
    }
    return false;
  }

  private maxWeekendAdSpend(salesRevenue: number) {
    const hardCap = Number(this.config.get<string>('META_WEEKEND_MAX_AD_SPEND_EUR') ?? 120);
    const salesPct = Number(this.config.get<string>('META_WEEKEND_MAX_AD_SPEND_PCT') ?? 18);
    const pctCap = salesRevenue > 0 ? salesRevenue * (salesPct / 100) : hardCap * 0.5;
    return +Math.max(20, Math.min(hardCap, pctCap)).toFixed(2);
  }

  private metaPaymentLimit() {
    const value = Number(this.config.get<string>('META_PAYMENT_LIMIT_EUR') ?? 200);
    return Number.isFinite(value) && value > 0 ? value : 200;
  }

  private metaPaymentWarningThreshold() {
    const configured = Number(this.config.get<string>('META_PAYMENT_WARNING_EUR') ?? 150);
    const limit = this.metaPaymentLimit();
    const value = Number.isFinite(configured) && configured > 0 ? configured : limit * 0.75;
    return +Math.min(value, limit).toFixed(2);
  }

  private parseMetaMoney(value?: string | number | null) {
    if (value == null) return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    // Some Meta ad-account monetary fields arrive in minor units. If it is a large integer,
    // normalize it to euros so the mobile app does not show 15000 € instead of 150 €.
    const isLargeInteger = Number.isInteger(parsed) && Math.abs(parsed) >= 1000;
    return +(isLargeInteger ? parsed / 100 : parsed).toFixed(2);
  }

  private billingHeadline(status: string, balanceDue: number, paymentLimit: number) {
    if (status === 'BAD') return `Paga Meta hoy: saldo ${this.money(balanceDue)} y limite ${this.money(paymentLimit)}.`;
    if (status === 'WATCH') return `Saldo Meta cerca del limite: ${this.money(balanceDue)} pendientes.`;
    if (status === 'GOOD') return `Saldo Meta controlado: ${this.money(balanceDue)} pendientes.`;
    return 'Sin saldo pendiente detectado en Meta.';
  }

  private billingAction(status: string) {
    if (status === 'BAD') return 'Entra en facturacion de Meta y paga ahora para que no se acumule ni bloquee campañas.';
    if (status === 'WATCH') return 'Conviene pagarlo hoy para no pasar el limite de facturacion.';
    if (status === 'GOOD') return 'Puedes pagarlo al cierre del dia para mantener la cuenta limpia.';
    return 'Revisa de nuevo al final del dia si hay gasto.';
  }

  private weekendCashStatus(isWeekend: boolean, spend: number, salesRevenue: number, maxWeekendSpend: number): 'GOOD' | 'WATCH' | 'BAD' | 'INFO' {
    if (!isWeekend) return 'INFO';
    if (spend > maxWeekendSpend) return 'BAD';
    if (salesRevenue <= 0 && spend >= 25) return 'BAD';
    if (spend > maxWeekendSpend * 0.75) return 'WATCH';
    if (salesRevenue > 0 && spend / salesRevenue > 0.22) return 'WATCH';
    return 'GOOD';
  }

  private weekendCashRecommendation(status: 'GOOD' | 'WATCH' | 'BAD' | 'INFO', isWeekend: boolean, spend: number, salesRevenue: number, maxWeekendSpend: number) {
    if (!isWeekend) {
      return {
        headline: 'Hoy no es modo finde. Puedes tomar decisiones normales, revisando margen y ROAS.',
        actions: [
          'El modo caja se activara para sabado/domingo.',
          'El lunes puedes restaurar presupuesto si el finde dejo ventas sanas.'
        ]
      };
    }
    if (status === 'BAD') {
      return {
        headline: 'Modo defensa: el gasto del finde esta por encima de lo prudente para caja.',
        actions: [
          'No escales ninguna campana hoy.',
          'Pausa pruebas y campanas sin compras atribuidas.',
          `Intenta cerrar el finde por debajo de ${this.money(maxWeekendSpend)} de gasto Meta.`,
          'Revisa el lunes cuando Shopify libere cobros antes de volver a subir presupuesto.'
        ]
      };
    }
    if (status === 'WATCH') {
      return {
        headline: 'Modo prudente: mantendria ganadoras, pero sin subir presupuesto.',
        actions: [
          'No apliques recomendaciones de escalar durante el finde.',
          'Baja presupuesto en campanas con ROAS bajo o cero compras.',
          `Quedan aproximadamente ${this.money(Math.max(0, maxWeekendSpend - spend))} de margen de gasto prudente.`,
          'Compara este sabado/domingo contra otros findes, no contra dias laborables.'
        ]
      };
    }
    return {
      headline: salesRevenue > 0
        ? 'Finde controlado: hay ventas y el gasto aun esta dentro del limite de caja.'
        : 'Finde tranquilo: gasto bajo, pero sin ventas confirmadas aun.',
      actions: [
        'Mantén presupuesto, sin escalar.',
        'Deja vivas solo las campanas que ya sabes que convierten.',
        'Si una campana gasta sin compras, bajala antes de que consuma caja.',
        'Prepara la decision fuerte para el lunes.'
      ]
    };
  }

  private applyWeekendRecommendationPolicy(recommendations: MetaRecommendation[], isWeekend: boolean) {
    if (!isWeekend) return recommendations;
    const guarded = recommendations.map((item) => {
      if (item.severity !== 'SCALE') return item;
      return {
        ...item,
        id: `${item.id}-weekend-guard`,
        severity: 'WATCH' as const,
        title: `No escalaria ahora: ${item.targetName}`,
        reason: `${item.reason} Pero el rango toca fin de semana y Shopify no libera caja hasta dia habil.`,
        action: 'Mantén o revisa el lunes. Durante el finde protege caja y no subas presupuesto automaticamente.',
        metricLabel: `Finde · ${item.metricLabel}`,
        priority: Math.max(60, item.priority - 15),
        suggestedDailyBudget: null
      };
    });
    if (!guarded.some((item) => item.id === 'account-weekend-cash-guard')) {
      guarded.unshift(this.recommendation({
        targetType: 'ACCOUNT',
        targetId: null,
        targetName: 'Cuenta Meta Ads',
        severity: 'WATCH',
        title: 'Modo finde: proteger caja',
        reason: 'El rango toca sabado/domingo y Shopify no paga hasta dia habil.',
        action: 'No escales presupuesto. Baja o pausa lo que gaste sin compras y vuelve a escalar el lunes si los datos aguantan.',
        metricLabel: 'Finde · caja',
        priority: 94
      }));
    }
    return this.rankRecommendations(guarded);
  }

  private buildCampaignRecommendations(campaigns: CampaignInsight[], accountRoas: number | null): MetaRecommendation[] {
    const recommendations: MetaRecommendation[] = [];
    const active = campaigns.filter((campaign) => campaign.status === 'ACTIVE');
    const totalSpend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
    const totalPurchases = campaigns.reduce((sum, campaign) => sum + campaign.purchases, 0);

    if (totalSpend >= 20 && totalPurchases === 0) {
      recommendations.push(this.recommendation({
        targetType: 'ACCOUNT',
        targetId: null,
        targetName: 'Cuenta Meta Ads',
        severity: 'WATCH',
        title: 'Hay gasto sin compras atribuidas',
        reason: `Se han gastado ${this.money(totalSpend)} en el rango y Meta no atribuye compras.`,
        action: 'Revisa pixel, eventos de compra y campañas activas antes de subir presupuesto.',
        metricLabel: `${this.money(totalSpend)} · 0 compras`,
        priority: 92
      }));
    }

    if (accountRoas != null && totalSpend >= 25 && accountRoas < 1.2) {
      recommendations.push(this.recommendation({
        targetType: 'ACCOUNT',
        targetId: null,
        targetName: 'Cuenta Meta Ads',
        severity: 'FIX',
        title: 'ROAS global bajo',
        reason: `El ROAS global del rango es ${accountRoas.toFixed(2)}x.`,
        action: 'No escales presupuesto general; concentra gasto en campañas con compras y pausa pruebas flojas.',
        solution: 'Solucion: revisar las campañas con peor ROAS, bajar presupuesto en las flojas y mantener solo las que traen compras.',
        metricLabel: `${accountRoas.toFixed(2)}x ROAS`,
        priority: 88
      }));
    }

    for (const campaign of active) {
      recommendations.push(...this.recommendForPerformance({
        targetType: 'CAMPAIGN',
        targetId: campaign.id,
        targetName: campaign.name,
        status: campaign.status,
        spend: campaign.spend,
        purchases: campaign.purchases,
        roas: campaign.roas,
        ctr: campaign.ctr,
        impressions: campaign.impressions
      }));
    }

    return this.rankRecommendations(recommendations);
  }

  private buildDetailRecommendations(campaign: CampaignInsight, adsets: AdSetInsight[], ads: AdInsight[]) {
    const recommendations: MetaRecommendation[] = [];
    recommendations.push(...this.recommendForPerformance({
      targetType: 'CAMPAIGN',
      targetId: campaign.id,
      targetName: campaign.name,
      status: campaign.status,
      spend: campaign.spend,
      purchases: campaign.purchases,
      roas: campaign.roas,
      ctr: campaign.ctr,
      impressions: campaign.impressions
    }));

    for (const adset of adsets.filter((item) => item.status === 'ACTIVE')) {
      recommendations.push(...this.recommendForPerformance({
        targetType: 'ADSET',
        targetId: adset.id,
        targetName: adset.name,
        status: adset.status,
        spend: adset.spend,
        purchases: adset.purchases,
        roas: adset.roas,
        ctr: adset.ctr,
        impressions: adset.impressions,
        dailyBudget: adset.dailyBudget
      }));
    }

    for (const ad of ads.filter((item) => item.status === 'ACTIVE')) {
      recommendations.push(...this.recommendForPerformance({
        targetType: 'AD',
        targetId: ad.id,
        targetName: ad.name,
        status: ad.status,
        spend: ad.spend,
        purchases: ad.purchases,
        roas: ad.roas,
        ctr: ad.ctr,
        impressions: ad.impressions
      }));
    }

    const bestAd = ads
      .filter((ad) => ad.spend >= 5 && ad.purchases > 0)
      .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
    if (bestAd && (bestAd.roas ?? 0) >= 2.5) {
      recommendations.push(this.recommendation({
        targetType: 'AD',
        targetId: bestAd.id,
        targetName: bestAd.name,
        severity: 'SCALE',
        title: 'Anuncio ganador detectado',
        reason: `${bestAd.name} tiene ${bestAd.purchases} compras y ROAS ${bestAd.roas?.toFixed(2)}x.`,
        action: 'Usalo como referencia creativa. Replica angulo, primera frase y visual en nuevas variantes.',
        metricLabel: `${bestAd.roas?.toFixed(2)}x · ${bestAd.purchases} compras`,
        priority: 86
      }));
    }

    return this.rankRecommendations(recommendations);
  }

  private recommendForPerformance(input: {
    targetType: 'CAMPAIGN' | 'ADSET' | 'AD';
    targetId: string;
    targetName: string;
    status: string;
    spend: number;
    purchases: number;
    roas: number | null;
    ctr: number | null;
    impressions: number;
    dailyBudget?: number | null;
  }): MetaRecommendation[] {
    if (input.status !== 'ACTIVE') return [];
    const recommendations: MetaRecommendation[] = [];
    const label = input.targetType === 'CAMPAIGN' ? 'campaña' : input.targetType === 'ADSET' ? 'grupo' : 'anuncio';
    const budget = input.dailyBudget ?? null;
    const suggestedBudget = budget != null ? +(budget * 1.15).toFixed(2) : null;

    if (input.spend >= 8 && input.purchases === 0) {
      recommendations.push(this.recommendation({
        targetType: input.targetType,
        targetId: input.targetId,
        targetName: input.targetName,
        severity: input.spend >= 20 ? 'PAUSE' : 'WATCH',
        title: input.spend >= 20 ? `Pausaria este ${label}` : `Vigila este ${label}`,
        reason: `${input.targetName} lleva ${this.money(input.spend)} de gasto y 0 compras.`,
        action: input.spend >= 20
          ? 'Pausalo o baja presupuesto hasta revisar audiencia, creatividad y evento de compra.'
          : 'Dale poco margen mas, pero no subas presupuesto hasta que genere compra.',
        metricLabel: `${this.money(input.spend)} · 0 compras`,
        priority: input.spend >= 20 ? 96 : 78
      }));
    }

    if (input.spend >= 12 && input.purchases > 0 && (input.roas ?? 0) < 1.1) {
      recommendations.push(this.recommendation({
        targetType: input.targetType,
        targetId: input.targetId,
        targetName: input.targetName,
        severity: 'FIX',
        title: `Rentabilidad floja en este ${label}`,
        reason: `${input.targetName} consigue compras, pero con ROAS ${input.roas?.toFixed(2) ?? '0.00'}x.`,
        action: 'No escales. Revisa margen, oferta, precio y landing antes de meter mas presupuesto.',
        solution: 'Solucion aplicable: bajar el presupuesto un 20% para proteger margen mientras revisas oferta, precio y pagina.',
        metricLabel: `${input.roas?.toFixed(2) ?? '0.00'}x ROAS`,
        priority: 84
      }));
    }

    if (input.spend >= 10 && input.purchases >= 2 && (input.roas ?? 0) >= 2.2) {
      recommendations.push(this.recommendation({
        targetType: input.targetType,
        targetId: input.targetId,
        targetName: input.targetName,
        severity: 'SCALE',
        title: `Subiria presupuesto en este ${label}`,
        reason: `${input.targetName} tiene ${input.purchases} compras y ROAS ${input.roas?.toFixed(2)}x.`,
        action: suggestedBudget != null
          ? `Sube de ${this.money(budget ?? 0)} a ${this.money(suggestedBudget)} diarios y vuelve a revisar manana.`
          : 'Sube presupuesto un 10-15% y vuelve a revisar manana; evita duplicar de golpe.',
        metricLabel: `${input.roas?.toFixed(2)}x · ${input.purchases} compras`,
        priority: 90,
        currentDailyBudget: budget,
        suggestedDailyBudget: suggestedBudget
      }));
    }

    if (input.impressions >= 1500 && input.spend >= 5 && (input.ctr ?? 0) > 0 && (input.ctr ?? 0) < 0.8) {
      recommendations.push(this.recommendation({
        targetType: input.targetType,
        targetId: input.targetId,
        targetName: input.targetName,
        severity: 'FIX',
        title: `CTR bajo en este ${label}`,
        reason: `${input.targetName} tiene CTR ${input.ctr?.toFixed(2)}% con ${input.impressions} impresiones.`,
        action: 'Cambia gancho, primera imagen/video o texto inicial. El problema parece mas creativo que presupuesto.',
        solution: input.targetType === 'AD'
          ? 'Solucion aplicable: pausar este anuncio para que deje de gastar mientras preparas una variante con mejor gancho.'
          : 'Solucion aplicable: bajar el presupuesto un 20% mientras cambias creatividades o copys dentro de este conjunto.',
        metricLabel: `${input.ctr?.toFixed(2)}% CTR`,
        priority: 72
      }));
    }

    if (input.spend < 5 && input.impressions < 1000) {
      recommendations.push(this.recommendation({
        targetType: input.targetType,
        targetId: input.targetId,
        targetName: input.targetName,
        severity: 'INFO',
        title: `Aun no hay suficientes datos en este ${label}`,
        reason: `${input.targetName} solo lleva ${this.money(input.spend)} de gasto.`,
        action: 'Dejalo correr un poco mas antes de decidir; todavia no hay gasto ni impresiones suficientes.',
        metricLabel: `${this.money(input.spend)} gastados`,
        priority: 30
      }));
    }

    return recommendations;
  }

  private recommendation(input: Omit<MetaRecommendation, 'id' | 'currentDailyBudget' | 'suggestedDailyBudget'> & Partial<Pick<MetaRecommendation, 'currentDailyBudget' | 'suggestedDailyBudget'>>) {
    return {
      id: `${input.targetType}:${input.targetId ?? 'account'}:${input.severity}:${input.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      currentDailyBudget: input.currentDailyBudget ?? null,
      suggestedDailyBudget: input.suggestedDailyBudget ?? null,
      ...input
    };
  }

  private rankRecommendations(items: MetaRecommendation[]) {
    const seen = new Set<string>();
    return items
      .sort((a, b) => b.priority - a.priority)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 12);
  }

  private money(value: number) {
    return `${value.toFixed(2)} €`;
  }

  private advisorIntent(question: string): 'PAUSE' | 'SCALE' | 'WEEKEND' | 'BILLING' | 'GENERAL' {
    const q = question.toLowerCase();
    if (/(paus|apagar|parar|cortar|quitar|mal|flojo|flojos|bajar|baja|reducir|reduce|menos presupuesto)/.test(q)) return 'PAUSE';
    if (/(subir|escalar|aumentar|presupuesto|meter mas|invertir mas|crecer)/.test(q)) return 'SCALE';
    if (/(finde|fin de semana|sabado|sábado|domingo|weekend|caja)/.test(q)) return 'WEEKEND';
    if (/(pagar|factur|saldo|limite|límite|deuda|meta cobra)/.test(q)) return 'BILLING';
    return 'GENERAL';
  }

  private buildAdvisorResponse(
    intent: 'PAUSE' | 'SCALE' | 'WEEKEND' | 'BILLING' | 'GENERAL',
    question: string,
    context: {
      summary: Awaited<ReturnType<MetaService['summary']>>;
      weekendCash: Awaited<ReturnType<MetaService['weekendCash']>> | null;
      billing: Awaited<ReturnType<MetaService['billingStatus']>> | null;
      risky: CampaignInsight[];
      winners: CampaignInsight[];
      topRecommendations: MetaRecommendation[];
    }
  ) {
    const { summary, weekendCash, billing, risky, winners, topRecommendations } = context;
    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = summary.configured && summary.campaigns.length > 0 ? 'HIGH' : summary.configured ? 'MEDIUM' : 'LOW';

    if (!summary.configured) {
      return {
        headline: 'Meta Ads no está conectado',
        answer: 'No puedo leer campañas reales todavía. Configura el token y la cuenta publicitaria para que el agente pueda responder con datos.',
        confidence: 'LOW' as const,
        nextActions: ['Revisar META_ACCESS_TOKEN y META_AD_ACCOUNT_ID en Railway', 'Volver a abrir Meta Ads y refrescar']
      };
    }

    if (intent === 'PAUSE') {
      if (risky.length === 0) {
        return {
          headline: 'No pausaría nada fuerte ahora',
          answer: `Con ${this.money(summary.spend)} gastados y ROAS ${summary.roas == null ? '—' : `${summary.roas.toFixed(2)}x`}, no veo campañas activas con gasto suficiente y señales claras de corte.`,
          confidence,
          nextActions: ['Mantén el seguimiento', 'Revisa de nuevo cuando una campaña supere 8-12 € de gasto sin compras']
        };
      }
      const names = risky.slice(0, 3).map((campaign) => `${campaign.name} (${this.money(campaign.spend)}, ${campaign.purchases} compras, ROAS ${campaign.roas?.toFixed(2) ?? '—'})`);
      return {
        headline: `Revisaría ${risky.length} campaña(s) antes de seguir gastando`,
        answer: `Mi lectura: las candidatas a pausar o arreglar son ${names.join('; ')}. Si una pasa de 20 € sin compras, la pausaría. Si tiene compras pero ROAS bajo, antes probaría creativo/oferta.`,
        confidence,
        nextActions: risky.slice(0, 3).map((campaign) => campaign.purchases === 0
          ? `Pausar o bajar ${campaign.name} si no tiene compras al refrescar`
          : `Arreglar ${campaign.name}: mantener solo si el ROAS sube por encima de 1.5x`)
      };
    }

    if (intent === 'SCALE') {
      if (winners.length === 0) {
        return {
          headline: 'Ahora no escalaría presupuesto',
          answer: 'No veo campañas activas con al menos 2 compras y ROAS sólido. Escalar sin esa base puede quemar caja, sobre todo si Shopify tarda en pagar.',
          confidence,
          nextActions: ['Esperar más muestra o ventas', 'Escalar solo cuando una campaña tenga 2+ compras y ROAS mayor de 2.2x']
        };
      }
      return {
        headline: `Puedes escalar ${winners.length} campaña(s) con cuidado`,
        answer: `Las mejores señales están en ${winners.slice(0, 3).map((campaign) => `${campaign.name} (ROAS ${campaign.roas?.toFixed(2)}x)`).join(', ')}. Yo subiría poco a poco, no de golpe.`,
        confidence,
        nextActions: winners.slice(0, 3).map((campaign) => `Subir ${campaign.name} un 10-15% y revisar mañana`)
      };
    }

    if (intent === 'WEEKEND') {
      const actions = weekendCash?.actions?.length ? weekendCash.actions : ['Usa el gasto diario real y el cobro pendiente de Shopify antes de subir presupuesto'];
      return {
        headline: weekendCash?.headline ?? 'Revisa caja antes de tocar ads',
        answer: weekendCash
          ? `Para este rango, Meta lleva ${this.money(weekendCash.spend)} y el límite prudente es ${this.money(weekendCash.maxWeekendSpend)}. Quedan ${this.money(weekendCash.remainingWeekendSpend)} de margen prudente.`
          : 'No he podido leer la caja de fin de semana, así que trataría el presupuesto con prudencia.',
        confidence: weekendCash ? confidence : 'MEDIUM' as const,
        nextActions: actions
      };
    }

    if (intent === 'BILLING') {
      return {
        headline: billing?.headline ?? 'No he podido leer el saldo de Meta',
        answer: billing
          ? `Saldo pendiente: ${this.money(billing.balanceDue)}. Tu aviso está en ${this.money(billing.warningThreshold)} y el límite en ${this.money(billing.paymentLimit)}.`
          : 'No he podido consultar facturación ahora mismo.',
        confidence: billing ? confidence : 'MEDIUM' as const,
        nextActions: [billing?.action ?? 'Abre Meta Billing y revisa el saldo manualmente']
      };
    }

    const firstRecommendation = topRecommendations[0];
    return {
      headline: firstRecommendation?.title ?? 'Lectura general de Meta Ads',
      answer: firstRecommendation
        ? `${firstRecommendation.reason} Mi acción sería: ${firstRecommendation.action}`
        : `Hoy llevas ${this.money(summary.spend)}, ${summary.purchases} compras y ROAS ${summary.roas == null ? '—' : `${summary.roas.toFixed(2)}x`}. Pregúntame por pausar, escalar, caja de finde o saldo de Meta para ir al grano.`,
      confidence,
      nextActions: topRecommendations.slice(0, 3).map((recommendation) => recommendation.action)
        .concat(topRecommendations.length ? [] : ['Mirar campañas con gasto sin compras', 'Escalar solo ganadoras con ROAS alto'])
    };
  }

  private advisorCampaignAdvice(campaign: CampaignInsight) {
    if (campaign.spend >= 20 && campaign.purchases === 0) return 'Pausar si sigue sin compras';
    if (campaign.spend >= 8 && campaign.purchases === 0) return 'Vigilar: gasta sin comprar';
    if ((campaign.roas ?? 0) >= 2.2 && campaign.purchases >= 2) return 'Candidata a escalar +10-15%';
    if (campaign.purchases > 0 && (campaign.roas ?? 0) < 1.1) return 'Arreglar creatividad/oferta antes de escalar';
    return 'Mantener y seguir midiendo';
  }

  private advisorActionSuggestions(
    intent: 'PAUSE' | 'SCALE' | 'WEEKEND' | 'BILLING' | 'GENERAL',
    recommendations: MetaRecommendation[],
    risky: CampaignInsight[],
    winners: CampaignInsight[]
  ): MetaAdvisorActionSuggestion[] {
    const picked: MetaAdvisorActionSuggestion[] = [];
    const pushRecommendation = (item: MetaRecommendation, label?: string) => {
      if (!item.targetId || !['CAMPAIGN', 'ADSET', 'AD'].includes(item.targetType)) return;
      if (!['SCALE', 'PAUSE', 'FIX'].includes(item.severity)) return;
      picked.push({
        id: item.id,
        label: label ?? item.title,
        detail: item.solution ?? item.action,
        targetType: item.targetType as 'CAMPAIGN' | 'ADSET' | 'AD',
        targetId: item.targetId,
        severity: item.severity as 'SCALE' | 'PAUSE' | 'FIX',
        suggestedDailyBudget: item.suggestedDailyBudget
      });
    };

    if (intent === 'PAUSE' || intent === 'WEEKEND') {
      for (const item of recommendations.filter((rec) => ['PAUSE', 'FIX'].includes(rec.severity))) {
        pushRecommendation(item, item.severity === 'PAUSE' ? `Pausar ${item.targetName}` : `Bajar presupuesto de ${item.targetName}`);
        if (picked.length >= 2) break;
      }
      if (picked.length === 0) {
        for (const campaign of risky.slice(0, 2)) {
          picked.push({
            id: `advisor-fix-${campaign.id}`,
            label: campaign.spend >= 20 ? `Pausar ${campaign.name}` : `Bajar presupuesto de ${campaign.name}`,
            detail: `${campaign.name} lleva ${this.money(campaign.spend)} y ${campaign.purchases} compras en el rango.`,
            targetType: 'CAMPAIGN',
            targetId: campaign.id,
            severity: campaign.spend >= 20 ? 'PAUSE' : 'FIX',
            suggestedDailyBudget: null
          });
        }
      }
    } else if (intent === 'SCALE') {
      for (const item of recommendations.filter((rec) => rec.severity === 'SCALE')) {
        pushRecommendation(item, `Subir ${item.targetName}`);
        if (picked.length >= 2) break;
      }
      if (picked.length === 0) {
        for (const campaign of winners.slice(0, 2)) {
          picked.push({
            id: `advisor-scale-${campaign.id}`,
            label: `Subir ${campaign.name}`,
            detail: `${campaign.name} tiene ${campaign.purchases} compras y ROAS ${campaign.roas?.toFixed(2) ?? '—'}x.`,
            targetType: 'CAMPAIGN',
            targetId: campaign.id,
            severity: 'SCALE',
            suggestedDailyBudget: null
          });
        }
      }
    } else {
      for (const item of recommendations) {
        pushRecommendation(item);
        if (picked.length >= 2) break;
      }
    }

    const seen = new Set<string>();
    return picked.filter((item) => {
      const key = `${item.targetType}:${item.targetId}:${item.severity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
  }

  private async saveAdvisorExchange(question: string, answer: unknown) {
    try {
      await this.ensureMetaAdvisorChatTable();
      const now = new Date();
      await this.prisma.$executeRawUnsafe(
        `insert into meta_advisor_chat_messages (id, role, text, answer_json, created_at)
         values ($1, $2, $3, $4::jsonb, $5), ($6, $7, $8, $9::jsonb, $10)`,
        `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        'user',
        question,
        null,
        now,
        `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        'assistant',
        (answer as { headline?: string; answer?: string }).headline ?? 'Respuesta Meta Ads',
        JSON.stringify(answer),
        now
      );
    } catch (error) {
      this.logger.warn(`No se pudo guardar el chat Meta Advisor: ${(error as Error).message}`);
    }
  }

  private async ensureMetaAdvisorChatTable() {
    await this.prisma.$executeRawUnsafe(`
      create table if not exists meta_advisor_chat_messages (
        id text primary key,
        role text not null,
        text text not null,
        answer_json jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      create index if not exists meta_advisor_chat_messages_created_idx
      on meta_advisor_chat_messages (created_at desc)
    `);
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

  async applyRecommendation(dto: ApplyMetaRecommendationDto) {
    this.assert();
    if (!dto.targetId || !['CAMPAIGN', 'ADSET', 'AD'].includes(dto.targetType)) {
      throw new BadRequestException('Recomendacion sin objetivo aplicable');
    }
    await this.assertRecommendationSafety(dto);
    const preview = await this.previewRecommendation(dto);

    if (dto.severity === 'PAUSE') {
      await this.graphPost(dto.targetId, { status: 'PAUSED' });
      const response = {
        ok: true,
        applied: true,
        targetType: dto.targetType,
        targetId: dto.targetId,
        action: 'PAUSED',
        message: 'Se ha pausado en Meta Ads.'
      };
      await this.recordRecommendationAction(dto, response, preview);
      return response;
    }

    if (dto.severity === 'SCALE') {
      // ADSET: bump the suggested daily budget directly.
      if (dto.targetType === 'ADSET') {
        let budget = Number(dto.suggestedDailyBudget ?? 0);
        if (!Number.isFinite(budget) || budget <= 0) {
          const adset = await this.graphGet<{ daily_budget?: string }>(dto.targetId, { fields: 'daily_budget' });
          const current = Number(adset.daily_budget ?? 0);
          if (current <= 0) {
            throw new BadRequestException('Este grupo no tiene presupuesto diario editable.');
          }
          budget = +(current / 100 * 1.15).toFixed(2);
        }
        await this.graphPost(dto.targetId, { daily_budget: Math.round(budget * 100) });
        const response = {
          ok: true,
          applied: true,
          targetType: dto.targetType,
          targetId: dto.targetId,
          action: 'BUDGET_UPDATED',
          suggestedDailyBudget: +budget.toFixed(2),
          message: `Presupuesto diario subido a ${budget.toFixed(2)} €.`
        };
        await this.recordRecommendationAction(dto, response, preview);
        return response;
      }

      // CAMPAIGN: resolve where the budget lives and bump +15%.
      if (dto.targetType === 'CAMPAIGN') {
        const campaign = await this.graphGet<{ daily_budget?: string }>(dto.targetId, { fields: 'daily_budget' });
        const campBudget = Number(campaign.daily_budget ?? 0);
        if (campBudget > 0) {
          const next = +(campBudget / 100 * 1.15).toFixed(2);
          await this.graphPost(dto.targetId, { daily_budget: Math.round(next * 100) });
          const response = {
            ok: true, applied: true, targetType: 'CAMPAIGN', targetId: dto.targetId,
            action: 'BUDGET_UPDATED', suggestedDailyBudget: next,
            message: `Presupuesto de campaña subido a ${next.toFixed(2)} €/día.`
          };
          await this.recordRecommendationAction(dto, response, preview);
          return response;
        }
        // No CBO → budget lives on adsets. Bump each active adset with a daily budget.
        const adsets = await this.graphGet<{ data: Array<{ id: string; daily_budget?: string; status?: string }> }>(
          `${dto.targetId}/adsets`,
          { fields: 'daily_budget,status', limit: '50' }
        );
        const targets = (adsets.data ?? []).filter((a) => Number(a.daily_budget ?? 0) > 0);
        if (!targets.length) {
          throw new BadRequestException('Esta campaña no tiene presupuesto diario editable (revisa presupuesto a nivel de grupo o de por vida en Meta).');
        }
        let total = 0;
        for (const a of targets) {
          const next = +(Number(a.daily_budget) / 100 * 1.15).toFixed(2);
          await this.graphPost(a.id, { daily_budget: Math.round(next * 100) });
          total += next;
        }
        const response = {
          ok: true, applied: true, targetType: 'CAMPAIGN', targetId: dto.targetId,
          action: 'BUDGET_UPDATED', suggestedDailyBudget: +total.toFixed(2),
          message: `Subido +15% en ${targets.length} grupo(s). Nuevo total ${total.toFixed(2)} €/día.`
        };
        await this.recordRecommendationAction(dto, response, preview);
        return response;
      }

      // AD: budget lives on its parent ad set. Bump that ad set +15%.
      if (dto.targetType === 'AD') {
        const ad = await this.graphGet<{ adset_id?: string; name?: string }>(dto.targetId, { fields: 'adset_id,name' });
        if (!ad.adset_id) {
          throw new BadRequestException('No encuentro el grupo de anuncios asociado a este anuncio.');
        }
        const adset = await this.graphGet<{ daily_budget?: string; name?: string }>(ad.adset_id, { fields: 'daily_budget,name' });
        const adsetBudget = Number(adset.daily_budget ?? 0);
        if (adsetBudget <= 0) {
          throw new BadRequestException('El grupo de este anuncio no tiene presupuesto diario editable.');
        }
        const next = +(adsetBudget / 100 * 1.15).toFixed(2);
        await this.graphPost(ad.adset_id, { daily_budget: Math.round(next * 100) });
        const response = {
          ok: true,
          applied: true,
          targetType: 'AD',
          targetId: dto.targetId,
          action: 'PARENT_ADSET_BUDGET_UPDATED',
          suggestedDailyBudget: next,
          message: `Anuncio ganador: presupuesto del grupo "${adset.name ?? ad.adset_id}" subido a ${next.toFixed(2)} €/día.`
        };
        await this.recordRecommendationAction(dto, response, preview);
        return response;
      }

      throw new BadRequestException('Solo puedo subir presupuesto en campañas o grupos de anuncios.');
    }

    if (dto.severity === 'FIX') {
      if (dto.targetType === 'AD') {
        await this.graphPost(dto.targetId, { status: 'PAUSED' });
        const response = {
          ok: true,
          applied: true,
          targetType: dto.targetType,
          targetId: dto.targetId,
          action: 'AD_PAUSED_FOR_FIX',
          message: 'Anuncio pausado en Meta Ads para cortar gasto mientras revisas creatividad/oferta.'
        };
        await this.recordRecommendationAction(dto, response, preview);
        return response;
      }

      const result = await this.adjustDailyBudget(dto.targetType, dto.targetId, 0.8);
      const response = {
        ok: true,
        applied: true,
        targetType: dto.targetType,
        targetId: dto.targetId,
        action: 'BUDGET_REDUCED_FOR_FIX',
        suggestedDailyBudget: result.total,
        message: result.message
      };
      await this.recordRecommendationAction(dto, response, preview);
      return response;
    }

    const response = {
      ok: true,
      applied: false,
      targetType: dto.targetType,
      targetId: dto.targetId,
      action: 'NO_AUTOMATIC_ACTION',
      message: 'Esta recomendacion requiere revision manual.'
    };
    await this.recordRecommendationAction(dto, response, preview);
    return response;
  }

  async previewRecommendation(dto: ApplyMetaRecommendationDto): Promise<MetaRecommendationPreview> {
    this.assert();
    if (!dto.targetId || !['CAMPAIGN', 'ADSET', 'AD'].includes(dto.targetType)) {
      throw new BadRequestException('Recomendacion sin objetivo aplicable');
    }
    if (!['SCALE', 'PAUSE', 'FIX'].includes(dto.severity)) {
      throw new BadRequestException('Esta recomendacion no tiene preview aplicable.');
    }

    const warnings = await this.recommendationSafetyWarnings(dto);
    let currentDailyBudget: number | null = null;
    let suggestedDailyBudget: number | null = null;
    let currentStatus: string | null = null;
    let nextStatus: string | null = null;
    let impact = 'Se aplicara el cambio en Meta Ads.';

    if (dto.severity === 'PAUSE' || (dto.severity === 'FIX' && dto.targetType === 'AD')) {
      const current = await this.graphGet<{ status?: string; effective_status?: string; name?: string }>(dto.targetId, {
        fields: 'status,effective_status,name'
      });
      currentStatus = current.status ?? current.effective_status ?? null;
      nextStatus = 'PAUSED';
      impact = dto.severity === 'FIX'
        ? `Pausara el anuncio "${current.name ?? dto.targetId}" para cortar gasto mientras revisas la creatividad.`
        : `Pausara "${current.name ?? dto.targetId}" y dejara de gastar.`;
    } else {
      const budgetInfo = await this.resolveEditableDailyBudget(dto);
      currentDailyBudget = budgetInfo.current;
      suggestedDailyBudget = dto.severity === 'FIX'
        ? +(budgetInfo.current * 0.8).toFixed(2)
        : +(Number(dto.suggestedDailyBudget ?? budgetInfo.current * 1.15)).toFixed(2);
      const currentBudget = currentDailyBudget;
      const nextBudget = suggestedDailyBudget;
      impact = dto.severity === 'FIX'
        ? `Bajara presupuesto de ${currentBudget.toFixed(2)} € a ${nextBudget.toFixed(2)} €/dia.`
        : `Subira presupuesto de ${currentBudget.toFixed(2)} € a ${nextBudget.toFixed(2)} €/dia.`;
    }

    return {
      canApply: warnings.length === 0,
      targetType: dto.targetType,
      targetId: dto.targetId,
      severity: dto.severity as 'SCALE' | 'PAUSE' | 'FIX',
      currentDailyBudget,
      suggestedDailyBudget,
      currentStatus,
      nextStatus,
      impact,
      warnings
    };
  }

  async recommendationHistory(limit = 30) {
    await this.ensureMetaRecommendationActionTable();
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      id: string;
      recommendation_id: string | null;
      target_type: string;
      target_id: string;
      severity: string;
      action: string;
      message: string;
      before_json: unknown;
      after_json: unknown;
      created_at: Date;
    }>>(
      `select * from meta_recommendation_actions order by created_at desc limit ${Math.max(1, Math.min(100, Number(limit) || 30))}`
    );
    return rows.map((row) => ({
      id: row.id,
      recommendationId: row.recommendation_id,
      targetType: row.target_type,
      targetId: row.target_id,
      severity: row.severity,
      action: row.action,
      message: row.message,
      before: row.before_json,
      after: row.after_json,
      createdAt: row.created_at
    }));
  }

  async learning(from?: string, to?: string) {
    const summary = await this.summary(from, to);
    const recs = summary.recommendations ?? [];
    const active = summary.campaigns.filter((c) => c.status === 'ACTIVE');
    const winners = active.filter((c) => c.purchases > 0 && (c.roas ?? 0) >= 2.2).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
    const losers = active.filter((c) => c.spend >= 12 && ((c.purchases === 0) || ((c.roas ?? 0) < 1.1))).sort((a, b) => b.spend - a.spend);
    const top = summary.bestSellers?.[0];
    return {
      headline: winners.length ? `Escalaria con cuidado: ${winners[0].name}` : losers.length ? `Hoy protegeria gasto: ${losers[0].name}` : 'Hoy toca observar sin forzar cambios',
      bullets: [
        winners.length ? `${winners.length} campaña(s) con señal buena para escalar poco a poco.` : 'No veo ganadores claros para escalar fuerte.',
        losers.length ? `${losers.length} campaña(s) gastando con señal floja.` : 'No veo campañas activas claramente peligrosas.',
        top ? `Producto con mejor señal: ${top.title} (${top.quantity} uds).` : 'Aun no hay producto ganador claro en este rango.',
        recs.some((r) => r.severity === 'FIX') ? 'Hay arreglos recomendados antes de subir mas presupuesto.' : 'No hay arreglos urgentes detectados.'
      ],
      nextAction: recs[0]?.title ?? 'Revisar datos de nuevo manana.',
      recommendationCount: recs.length
    };
  }

  async dailyPlan(from?: string, to?: string) {
    const summary = await this.summary(from, to);
    const candidates = (summary.recommendations ?? [])
      .filter((item) => item.targetId && ['SCALE', 'PAUSE', 'FIX'].includes(item.severity))
      .slice(0, 8);

    const items: MetaDailyPlanItem[] = [];
    for (const recommendation of candidates) {
      const dto: ApplyMetaRecommendationDto = {
        targetType: recommendation.targetType as 'CAMPAIGN' | 'ADSET' | 'AD',
        targetId: recommendation.targetId!,
        severity: recommendation.severity,
        suggestedDailyBudget: recommendation.suggestedDailyBudget
      };
      try {
        const preview = await this.previewRecommendation(dto);
        items.push({
          recommendation,
          preview,
          canApply: preview.canApply,
          skipReason: preview.warnings.length ? preview.warnings.join(' ') : null
        });
      } catch (error) {
        items.push({
          recommendation,
          preview: null,
          canApply: false,
          skipReason: error instanceof Error ? error.message : 'No se pudo preparar la vista previa.'
        });
      }
    }

    const scale = items.filter((item) => item.recommendation.severity === 'SCALE' && item.canApply).length;
    const pause = items.filter((item) => item.recommendation.severity === 'PAUSE' && item.canApply).length;
    const fix = items.filter((item) => item.recommendation.severity === 'FIX' && item.canApply).length;
    const headline = items.some((item) => item.canApply)
      ? `Hoy aplicaria ${scale + pause + fix} accion(es): ${scale} subir, ${fix} arreglar, ${pause} pausar.`
      : 'Hoy no aplicaria cambios automaticos; revisaria los datos.';

    return {
      from: summary.from,
      to: summary.to,
      headline,
      items,
      totals: { scale, fix, pause, applicable: scale + fix + pause, blocked: items.filter((item) => !item.canApply).length }
    };
  }

  async applyDailyPlan(body: ApplyMetaDailyPlanDto) {
    const items = (body.items ?? [])
      .filter((item) => item.targetId && ['CAMPAIGN', 'ADSET', 'AD'].includes(item.targetType) && ['SCALE', 'PAUSE', 'FIX'].includes(item.severity))
      .slice(0, 8);
    if (!items.length) throw new BadRequestException('Plan sin acciones aplicables.');

    const results: Array<{ ok: boolean; targetId: string; severity: string; message: string }> = [];
    for (const item of items) {
      try {
        const result = await this.applyRecommendation(item);
        results.push({ ok: true, targetId: item.targetId, severity: item.severity, message: result.message });
      } catch (error) {
        results.push({
          ok: false,
          targetId: item.targetId,
          severity: item.severity,
          message: error instanceof Error ? error.message : 'No se pudo aplicar.'
        });
      }
    }

    return {
      ok: true,
      applied: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
      message: `Plan aplicado: ${results.filter((item) => item.ok).length} OK, ${results.filter((item) => !item.ok).length} fallo(s).`
    };
  }

  private async adjustDailyBudget(targetType: 'CAMPAIGN' | 'ADSET' | 'AD', targetId: string, multiplier: number) {
    if (targetType === 'ADSET') {
      const adset = await this.graphGet<{ daily_budget?: string; name?: string }>(targetId, { fields: 'daily_budget,name' });
      const current = Number(adset.daily_budget ?? 0);
      if (current <= 0) throw new BadRequestException('Este grupo no tiene presupuesto diario editable.');
      const next = +(current / 100 * multiplier).toFixed(2);
      await this.graphPost(targetId, { daily_budget: Math.round(next * 100) });
      return { total: next, message: `Presupuesto de "${adset.name ?? targetId}" bajado a ${next.toFixed(2)} €/día.` };
    }

    if (targetType === 'CAMPAIGN') {
      const campaign = await this.graphGet<{ daily_budget?: string; name?: string }>(targetId, { fields: 'daily_budget,name' });
      const campBudget = Number(campaign.daily_budget ?? 0);
      if (campBudget > 0) {
        const next = +(campBudget / 100 * multiplier).toFixed(2);
        await this.graphPost(targetId, { daily_budget: Math.round(next * 100) });
        return { total: next, message: `Presupuesto de campaña bajado a ${next.toFixed(2)} €/día.` };
      }

      const adsets = await this.graphGet<{ data: Array<{ id: string; daily_budget?: string; name?: string }> }>(
        `${targetId}/adsets`,
        { fields: 'daily_budget,name', limit: '50' }
      );
      const targets = (adsets.data ?? []).filter((a) => Number(a.daily_budget ?? 0) > 0);
      if (!targets.length) throw new BadRequestException('Esta campaña no tiene presupuesto diario editable.');

      let total = 0;
      for (const a of targets) {
        const next = +(Number(a.daily_budget) / 100 * multiplier).toFixed(2);
        await this.graphPost(a.id, { daily_budget: Math.round(next * 100) });
        total += next;
      }
      return { total: +total.toFixed(2), message: `Presupuesto bajado un 20% en ${targets.length} grupo(s). Nuevo total ${total.toFixed(2)} €/día.` };
    }

    throw new BadRequestException('No puedo ajustar presupuesto directamente en este objetivo.');
  }

  private async resolveEditableDailyBudget(dto: ApplyMetaRecommendationDto): Promise<{ current: number; targetCount: number }> {
    if (dto.targetType === 'AD') {
      const ad = await this.graphGet<{ adset_id?: string }>(dto.targetId, { fields: 'adset_id' });
      if (!ad.adset_id) throw new BadRequestException('No encuentro el grupo de anuncios asociado.');
      return this.resolveEditableDailyBudget({ ...dto, targetType: 'ADSET', targetId: ad.adset_id });
    }

    const current = await this.graphGet<{ daily_budget?: string; name?: string }>(dto.targetId, { fields: 'daily_budget,name' });
    const ownBudget = Number(current.daily_budget ?? 0);
    if (ownBudget > 0) return { current: +(ownBudget / 100).toFixed(2), targetCount: 1 };

    if (dto.targetType === 'CAMPAIGN') {
      const adsets = await this.graphGet<{ data: Array<{ id: string; daily_budget?: string }> }>(
        `${dto.targetId}/adsets`,
        { fields: 'daily_budget', limit: '50' }
      );
      const budgets = (adsets.data ?? []).map((a) => Number(a.daily_budget ?? 0)).filter((value) => value > 0);
      if (budgets.length) {
        return { current: +(budgets.reduce((sum, value) => sum + value, 0) / 100).toFixed(2), targetCount: budgets.length };
      }
    }

    throw new BadRequestException('No encuentro presupuesto diario editable para esta recomendacion.');
  }

  private async assertRecommendationSafety(dto: ApplyMetaRecommendationDto) {
    const warnings = await this.recommendationSafetyWarnings(dto);
    if (warnings.length) throw new BadRequestException(warnings.join(' '));
  }

  private async recommendationSafetyWarnings(dto: ApplyMetaRecommendationDto) {
    await this.ensureMetaRecommendationActionTable();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: string }>>(
      `select count(*)::text as count from meta_recommendation_actions where target_id = $1 and severity = $2 and created_at >= $3`,
      dto.targetId,
      dto.severity,
      since
    );
    const count = Number(rows[0]?.count ?? 0);
    const warnings: string[] = [];
    if (dto.severity === 'SCALE' && count >= 2) {
      warnings.push('Seguridad: esta campaña/grupo/anuncio ya se ha escalado 2 veces en las ultimas 24h.');
    }
    if (dto.severity === 'FIX' && count >= 2) {
      warnings.push('Seguridad: este objetivo ya se ha arreglado 2 veces en las ultimas 24h.');
    }
    if (dto.severity === 'PAUSE' && count >= 1) {
      warnings.push('Seguridad: este objetivo ya fue pausado desde la app en las ultimas 24h.');
    }
    return warnings;
  }

  private async recordRecommendationAction(
    dto: ApplyMetaRecommendationDto,
    response: { action?: string | null; message: string; suggestedDailyBudget?: number | null },
    preview: MetaRecommendationPreview
  ) {
    await this.ensureMetaRecommendationActionTable();
    await this.prisma.$executeRawUnsafe(
      `insert into meta_recommendation_actions
       (id, recommendation_id, target_type, target_id, severity, action, message, before_json, after_json, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,now())`,
      cryptoRandomId(),
      `${dto.targetType}:${dto.targetId}:${dto.severity}`.toLowerCase(),
      dto.targetType,
      dto.targetId,
      dto.severity,
      response.action ?? 'APPLIED',
      response.message,
      JSON.stringify({
        dailyBudget: preview.currentDailyBudget,
        status: preview.currentStatus
      }),
      JSON.stringify({
        dailyBudget: response.suggestedDailyBudget ?? preview.suggestedDailyBudget,
        status: preview.nextStatus,
        impact: preview.impact
      })
    );
  }

  private async ensureMetaRecommendationActionTable() {
    await this.prisma.$executeRawUnsafe(`
      create table if not exists meta_recommendation_actions (
        id text primary key,
        recommendation_id text,
        target_type text not null,
        target_id text not null,
        severity text not null,
        action text not null,
        message text not null,
        before_json jsonb,
        after_json jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      create index if not exists meta_recommendation_actions_target_created_idx
      on meta_recommendation_actions (target_id, severity, created_at desc)
    `);
  }
}

function cryptoRandomId() {
  return `mra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
