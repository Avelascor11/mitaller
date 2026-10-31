import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import * as d from './marketing.domain';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const terminal = ['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'UNKNOWN', 'SKIPPED', 'CANCELLED'];
const suppressed = ['UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED'];
const tracked = ['MARKETING', 'TRANSACTIONAL'];
const stripId = (v: unknown) => typeof v === 'string' ? v.trim().replace(/^<|>$/g, '') : '';
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined; };
type Tx = Prisma.TransactionClient;
type Transport = ReturnType<typeof nodemailer.createTransport>;
type ContactInput = { email: string; firstName?: string; lastName?: string; country?: string; tags?: string[]; status?: string; consentAt?: Date | null; consentSource?: string | null };
type ImportPart = 'profiles' | 'lists' | 'segments' | 'orders';
type ImportJob = { running: boolean; processed: number; imported: number; skipped: number; stage?: string; parts?: ImportPart[]; lists?: number; segments?: number; orders?: number; startedAt?: string; finishedAt?: string; error?: string };
/** Flow tests use this when the trigger has never fired; keys match what Shopify and the onsite script send. */
const sampleEvent = { orderNumber: '1001', total: '49,90', itemsText: '1 × Camiseta Speedwear (M)', checkoutUrl: 'https://speedwear.es/cart', title: 'Camiseta Speedwear', url: 'https://speedwear.es', price: '24,95' };

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);
  private working = false;
  private klaviyoJob: ImportJob = { running: false, processed: 0, imported: 0, skipped: 0 };
  constructor(private readonly db: PrismaService, private readonly config: ConfigService) {}
  private env(key: string) { return this.config.get<string>(`MARKETING_${key}`)?.trim() ?? ''; }
  settings() {
    const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'FROM_EMAIL', 'POSTAL_ADDRESS', 'PUBLIC_API_URL'];
    const checks = required.map(key => ({ key, ready: Boolean(this.env(key)) }));
    checks.push({ key: 'PUBLIC_API_URL_HTTPS', ready: Boolean(d.safeUrl(this.env('PUBLIC_API_URL'))) });
    checks.push({ key: 'SEND_ENABLED', ready: this.env('SEND_ENABLED') === 'true' });
    return {
      ready: checks.every(c => c.ready), checks, fromEmail: this.env('FROM_EMAIL'), fromName: this.env('FROM_NAME') || 'Speedwear', address: this.env('POSTAL_ADDRESS'), publicApiUrl: this.env('PUBLIC_API_URL'),
      integrationConfigured: this.env('EVENT_SECRET').length >= 32, captureEvents: this.env('CAPTURE_EVENTS') === 'true', shopifyWebhooks: Boolean(this.config.get<string>('SHOPIFY_WEBHOOK_SECRET')), klaviyoImport: Boolean(this.config.get<string>('KLAVIYO_API_KEY')),
      attributionDays: this.attributionDays(), batchSize: this.batchSize(), shopifySync: this.shopifySync
    };
  }
  private attributionDays() { return Math.max(1, Math.min(30, Number(this.env('ATTRIBUTION_DAYS')) || 5)); }
  private batchSize() { return Math.max(1, Math.min(1000, Number(this.env('BATCH_SIZE')) || 100)); }
  private requireReady() { if (!this.settings().ready) throw new BadRequestException('Completa la configuración SMTP y habilita los envíos antes de activar campañas o automatizaciones.'); }
  private transport(): Transport {
    if (!this.env('SMTP_HOST') || !this.env('SMTP_USER') || !this.env('SMTP_PASSWORD') || !this.env('FROM_EMAIL')) throw new BadRequestException('Falta la configuración SMTP.');
    return nodemailer.createTransport({ host: this.env('SMTP_HOST'), port: Number(this.env('SMTP_PORT') || 587), secure: this.env('SMTP_PORT') === '465', requireTLS: true, auth: { user: this.env('SMTP_USER'), pass: this.env('SMTP_PASSWORD') }, pool: true, maxConnections: 3, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000 });
  }
  private from() { return { name: this.env('FROM_NAME') || 'Speedwear', address: this.env('FROM_EMAIL') }; }

  // ── Dashboard ──
  async overview() {
    const since = new Date(Date.now() - 30 * 86400000);
    const [contacts, subscribed, statuses, opened, clicked, recentCampaigns, activeFlows, daily, failures, attributed, orders] = await Promise.all([
      this.db.marketingContact.count(), this.db.marketingContact.count({ where: { status: 'SUBSCRIBED' } }),
      this.db.marketingMessage.groupBy({ by: ['status'], where: { createdAt: { gte: since }, kind: 'MARKETING' }, _count: true }),
      this.db.marketingMessage.count({ where: { sentAt: { gte: since }, openedAt: { not: null }, kind: 'MARKETING' } }),
      this.db.marketingMessage.count({ where: { sentAt: { gte: since }, clickedAt: { not: null }, kind: 'MARKETING' } }),
      this.db.marketingCampaign.findMany({ take: 6, orderBy: { createdAt: 'desc' }, include: { _count: { select: { messages: true } } } }),
      this.db.marketingFlow.count({ where: { status: 'LIVE' } }),
      this.db.$queryRaw<Array<{ day: string; count: bigint }>>`SELECT TO_CHAR("sentAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*) AS count FROM "MarketingMessage" WHERE "sentAt" >= ${since} AND kind = 'MARKETING' GROUP BY day ORDER BY day`,
      this.db.marketingMessage.findMany({ where: { status: { in: ['FAILED', 'UNKNOWN'] } }, take: 10, orderBy: { updatedAt: 'desc' }, select: { id: true, status: true, error: true, updatedAt: true, contact: { select: { email: true } } } }),
      this.db.marketingEvent.aggregate({ where: { name: 'Placed Order', createdAt: { gte: since }, messageId: { not: null } }, _sum: { value: true }, _count: true }),
      this.db.marketingEvent.aggregate({ where: { name: 'Placed Order', createdAt: { gte: since } }, _sum: { value: true }, _count: true })
    ]);
    return {
      contacts, subscribed, statuses: Object.fromEntries(statuses.map(s => [s.status, s._count])), opened, clicked, recentCampaigns, activeFlows, daily: daily.map(r => ({ day: r.day, count: Number(r.count) })), failures, settings: this.settings(),
      revenue: { attributed: attributed._sum.value ?? 0, attributedOrders: attributed._count, total: orders._sum.value ?? 0, orders: orders._count }
    };
  }

  // ── Contacts ──
  async contacts(search = '', page = 1, status = '') {
    page = Math.max(1, Math.min(10000, Number(page) || 1));
    const where: Prisma.MarketingContactWhereInput = {
      ...(search ? { OR: ['email', 'firstName', 'lastName'].map(field => ({ [field]: { contains: search.slice(0, 100), mode: 'insensitive' } })) } : {}),
      ...(['PENDING', 'SUBSCRIBED', ...suppressed].includes(status) ? { status } : {})
    };
    const [items, total] = await Promise.all([this.db.marketingContact.findMany({ where, select: d.contactFields, orderBy: { createdAt: 'desc' }, take: 50, skip: (page - 1) * 50 }), this.db.marketingContact.count({ where })]);
    return { items, total, page };
  }
  async contact(id: string) {
    const contact = await this.db.marketingContact.findUnique({ where: { id }, select: { ...d.contactFields, events: { take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, value: true, properties: true, createdAt: true } }, messages: { take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, status: true, dueAt: true, sentAt: true, openedAt: true, clickedAt: true, error: true, campaign: { select: { name: true } }, flow: { select: { name: true } } } } } });
    if (!contact) throw new NotFoundException();
    return contact;
  }
  async deleteContact(id: string) {
    const result = await this.db.marketingContact.deleteMany({ where: { id } });
    if (!result.count) throw new NotFoundException();
    return { deleted: true };
  }
  /** Upserts a contact without ever clearing a suppression. Returns the contact and whether it just became SUBSCRIBED. */
  private async mergeContact(tx: Tx, input: ContactInput, opts: { mergeTags?: boolean; fillOnly?: boolean } = {}) {
    const existing = await tx.marketingContact.findUnique({ where: { email: input.email } });
    const data: Prisma.MarketingContactUncheckedCreateInput = { email: input.email };
    for (const key of ['firstName', 'lastName', 'country'] as const) if (input[key] != null && (!opts.fillOnly || !existing?.[key])) data[key] = input[key]!;
    if (input.tags) data.tags = opts.mergeTags && existing ? [...new Set([...existing.tags, ...input.tags])].slice(0, 30) : input.tags;
    if (input.status) {
      // Suppressions only move forward: imports, Shopify or manual edits can never re-subscribe a suppressed contact.
      const blocked = existing && suppressed.includes(existing.status) && !(['BOUNCED', 'COMPLAINED'].includes(input.status) && existing.status === 'UNSUBSCRIBED') && !(input.status === 'COMPLAINED' && existing.status === 'BOUNCED');
      if (!blocked) {
        data.status = input.status;
        if (input.status === 'SUBSCRIBED' && existing?.status !== 'SUBSCRIBED') { data.consentAt = input.consentAt ?? new Date(); data.consentSource = input.consentSource ?? null; }
        if (input.status === 'PENDING' && existing?.status === 'SUBSCRIBED') delete data.status;
      }
    }
    const contact = await tx.marketingContact.upsert({ where: { email: input.email }, create: data, update: { ...data, email: undefined }, select: d.contactFields });
    if (contact.status !== 'SUBSCRIBED') await tx.marketingMessage.updateMany({ where: { contactId: contact.id, kind: 'MARKETING', status: 'QUEUED' }, data: { status: 'SKIPPED', error: 'Contacto sin suscripción activa.' } });
    if (['BOUNCED', 'COMPLAINED'].includes(contact.status)) await tx.marketingMessage.updateMany({ where: { contactId: contact.id, status: 'QUEUED' }, data: { status: 'SKIPPED', error: contact.status } });
    return { contact, subscribedNow: contact.status === 'SUBSCRIBED' && existing?.status !== 'SUBSCRIBED' };
  }
  private contactInput(body: Record<string, any>): ContactInput {
    const email = d.email(body.email);
    const status = body.status == null || body.status === '' ? undefined : body.status;
    if (status && !['PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED'].includes(status)) throw new BadRequestException('Estado de contacto inválido.');
    const consentSource = d.string(body.consentSource, 'Origen del consentimiento', 200, true);
    const consentAt = body.consentAt ? new Date(body.consentAt) : null;
    if (status === 'SUBSCRIBED' && (!consentSource || !consentAt || !Number.isFinite(consentAt.getTime()) || consentAt.getTime() > Date.now() + 60000)) throw new BadRequestException('Indica origen y fecha válida del consentimiento.');
    const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map((t: unknown) => d.string(t, 'Etiqueta', 60)))] as string[] : undefined;
    if (tags && tags.length > 30) throw new BadRequestException('Máximo 30 etiquetas.');
    const optional = (key: string, label: string) => body[key] == null ? undefined : d.string(body[key], label, 100, true);
    return { email, firstName: optional('firstName', 'Nombre'), lastName: optional('lastName', 'Apellidos'), country: optional('country', 'País'), tags, status, consentSource: consentSource || null, consentAt };
  }
  async saveContact(body: Record<string, any>) {
    const input = this.contactInput(body);
    return (await this.db.$transaction(tx => this.mergeContact(tx, input))).contact;
  }
  async importContacts(body: { contacts?: unknown; tags?: unknown }) {
    if (!Array.isArray(body.contacts) || !body.contacts.length || body.contacts.length > 1000) throw new BadRequestException('Importa entre 1 y 1000 contactos por lote.');
    const errors: { row: number; error: string }[] = []; let imported = 0;
    for (const [i, raw] of body.contacts.entries()) {
      try {
        const input = this.contactInput(raw ?? {});
        await this.db.$transaction(tx => this.mergeContact(tx, input, { mergeTags: true }));
        imported++;
      } catch (e) { errors.push({ row: i + 1, error: e instanceof Error ? e.message : 'Error' }); }
    }
    return { imported, errors };
  }
  async suppress(id: string) {
    const c = await this.db.marketingContact.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    return this.unsubscribe(c.unsubscribeToken);
  }

  // ── Segments, templates ──
  async segments() {
    const items = await this.db.marketingSegment.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(items.map(async item => ({ ...item, count: await this.db.marketingContact.count({ where: d.audienceWhere(item.rules as d.Rules) }) })));
  }
  async segmentPreview(body: Record<string, any>) { return { count: await this.db.marketingContact.count({ where: d.audienceWhere(d.rules(body.rules)) }) }; }
  async saveSegment(body: Record<string, any>, id?: string) {
    const data = { name: d.string(body.name, 'Nombre'), rules: json(d.rules(body.rules)) };
    return id ? this.db.marketingSegment.update({ where: { id }, data }) : this.db.marketingSegment.create({ data });
  }
  async deleteSegment(id: string) {
    if (await this.db.marketingCampaign.count({ where: { segmentId: id, status: { in: ['DRAFT', 'SCHEDULED'] } } })) throw new ConflictException('Hay campañas pendientes que usan este segmento.');
    await this.db.marketingSegment.deleteMany({ where: { id } });
    return { deleted: true };
  }
  templates() { return this.db.marketingTemplate.findMany({ orderBy: { updatedAt: 'desc' } }); }
  private content(body: Record<string, any>) { return { name: d.string(body.name, 'Nombre'), subject: d.string(body.subject, 'Asunto'), preheader: d.string(body.preheader, 'Preencabezado', 200, true), blocks: json(d.blocks(body.blocks)) }; }
  saveTemplate(body: Record<string, any>, id?: string) { const data = this.content(body); return id ? this.db.marketingTemplate.update({ where: { id }, data }) : this.db.marketingTemplate.create({ data }); }
  async deleteTemplate(id: string) {
    const flows = await this.db.marketingFlow.findMany({ select: { name: true, steps: true } });
    const used = flows.find(f => (f.steps as d.Step[]).some(s => s.templateId === id));
    if (used) throw new ConflictException(`La automatización «${used.name}» usa esta plantilla.`);
    await this.db.marketingTemplate.deleteMany({ where: { id } });
    return { deleted: true };
  }
  preview(body: Record<string, any>) { const c = this.content({ ...body, name: body.name || 'Vista previa' }); return d.renderEmail({ ...c, blocks: c.blocks as d.Block[], event: body.event && typeof body.event === 'object' ? body.event : undefined }, { firstName: 'Ángel', lastName: 'García', email: 'vista-previa@example.com' }, { address: this.settings().address || undefined }); }
  async sendTest(body: Record<string, any>) {
    const to = d.email(body.email);
    const c = this.content({ ...body, name: body.name || 'Prueba' });
    const contact = await this.db.marketingContact.findUnique({ where: { email: to } }) ?? { firstName: 'Ángel', lastName: 'García', email: to };
    const payload: d.MessagePayload = { ...c, blocks: c.blocks as d.Block[], event: body.event && typeof body.event === 'object' ? body.event : undefined };
    const transport = this.transport();
    try { await this.sendPreview(transport, to, '[Prueba]', payload, contact); } finally { transport.close(); }
    return { sent: true };
  }
  /** Sends every step of a flow right now as "[Prueba n/N]", filled with the latest real trigger event (or a sample), so the whole sequence can be checked without waiting for delays. */
  async testFlow(id: string, body: Record<string, any>) {
    const to = d.email(body.email);
    const flow = await this.db.marketingFlow.findUnique({ where: { id } });
    if (!flow) throw new NotFoundException('Automatización no encontrada.');
    // Imported Klaviyo history keeps Klaviyo's property names, so live events are preferred.
    const real = await this.db.marketingEvent.findFirst({ where: { name: flow.trigger, NOT: { externalId: { startsWith: 'klaviyo:' } } }, orderBy: { createdAt: 'desc' }, select: { properties: true, createdAt: true } })
      ?? await this.db.marketingEvent.findFirst({ where: { name: flow.trigger }, orderBy: { createdAt: 'desc' }, select: { properties: true, createdAt: true } });
    const event = real?.properties && typeof real.properties === 'object' && !Array.isArray(real.properties) ? real.properties as Record<string, unknown> : sampleEvent;
    const contact = await this.db.marketingContact.findUnique({ where: { email: to } }) ?? { firstName: 'Ángel', lastName: 'García', email: to };
    const steps = d.steps(flow.steps);
    const results: { subject: string; sent: boolean; error?: string }[] = [];
    const transport = this.transport();
    try {
      for (const [i, step] of steps.entries()) {
        const t = await this.db.marketingTemplate.findUnique({ where: { id: step.templateId } });
        if (!t) { results.push({ subject: '', sent: false, error: 'Plantilla borrada.' }); continue; }
        try {
          await this.sendPreview(transport, to, `[Prueba ${i + 1}/${steps.length}]`, { subject: t.subject, preheader: t.preheader, blocks: t.blocks as d.Block[], event }, contact);
          results.push({ subject: t.subject, sent: true });
        } catch (e) { results.push({ subject: t.subject, sent: false, error: e instanceof Error ? e.message : String(e) }); }
      }
    } finally { transport.close(); }
    return { sample: real ? 'real' : 'ejemplo', sampleAt: real?.createdAt ?? null, steps: results };
  }
  private async sendPreview(transport: Transport, to: string, prefix: string, payload: d.MessagePayload, contact: { firstName?: string | null; lastName?: string | null; email?: string }) {
    const person = { firstName: contact.firstName ?? undefined, lastName: contact.lastName ?? undefined, email: contact.email };
    const rendered = d.renderEmail(payload, person, { address: this.env('POSTAL_ADDRESS') || undefined });
    try {
      await transport.sendMail({ from: this.from(), to, subject: `${prefix} ${d.personalize(payload.subject, person, payload.event)}`.replace(/[\r\n]/g, ' '), html: rendered.html, text: rendered.text, disableFileAccess: true, disableUrlAccess: true });
    } catch (e: any) { throw new BadRequestException(`SMTP rechazó la prueba (${e.code || e.responseCode || 'error'}${e.response ? `: ${String(e.response).slice(0, 300)}` : ''}).`); }
  }

  // ── Campaigns ──
  async campaigns() {
    const items = await this.db.marketingCampaign.findMany({ take: 100, orderBy: { createdAt: 'desc' }, include: { _count: { select: { messages: true } } } });
    return Promise.all(items.map(async c => ({ ...c, stats: await this.messageStats({ campaignId: c.id }) })));
  }
  private async messageStats(where: Prisma.MarketingMessageWhereInput) {
    const [sent, opened, clicked, bounced, unsubscribed, revenue] = await Promise.all([
      this.db.marketingMessage.count({ where: { ...where, sentAt: { not: null } } }),
      this.db.marketingMessage.count({ where: { ...where, openedAt: { not: null } } }),
      this.db.marketingMessage.count({ where: { ...where, clickedAt: { not: null } } }),
      this.db.marketingMessage.count({ where: { ...where, status: { in: ['BOUNCED', 'COMPLAINED'] } } }),
      this.db.marketingMessage.count({ where: { ...where, unsubscribedAt: { not: null } } }),
      this.db.marketingEvent.aggregate({ where: { name: 'Placed Order', message: where }, _sum: { value: true }, _count: true })
    ]);
    return { sent, opened, clicked, bounced, unsubscribed, revenue: revenue._sum.value ?? 0, orders: revenue._count };
  }
  async campaign(id: string) {
    const campaign = await this.db.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException();
    const [statuses, messages, stats] = await Promise.all([
      this.db.marketingMessage.groupBy({ by: ['status'], where: { campaignId: id }, _count: true }),
      this.db.marketingMessage.findMany({ where: { campaignId: id }, take: 50, orderBy: { updatedAt: 'desc' }, select: { id: true, status: true, error: true, sentAt: true, openedAt: true, clickedAt: true, contact: { select: { email: true } } } }),
      this.messageStats({ campaignId: id })
    ]);
    return { ...campaign, statuses: Object.fromEntries(statuses.map(s => [s.status, s._count])), messages, stats, opened: stats.opened, clicked: stats.clicked, audience: await this.audienceCount(campaign.segmentId) };
  }
  private async audience(segmentId?: string | null) {
    if (!segmentId) return d.audienceWhere();
    const segment = await this.db.marketingSegment.findUnique({ where: { id: segmentId } });
    if (!segment) throw new BadRequestException('No existe el segmento.');
    return d.audienceWhere(segment.rules as d.Rules);
  }
  async audienceCount(segmentId?: string | null) { return this.db.marketingContact.count({ where: await this.audience(segmentId) }); }
  async saveCampaign(body: Record<string, any>, id?: string) {
    const segmentId = d.string(body.segmentId, 'Segmento', 100, true) || null;
    await this.audience(segmentId);
    const data = { ...this.content(body), segmentId };
    if (!id) return this.db.marketingCampaign.create({ data });
    const result = await this.db.marketingCampaign.updateMany({ where: { id, status: 'DRAFT' }, data });
    if (!result.count) throw new ConflictException('Solo se pueden editar borradores.');
    return this.db.marketingCampaign.findUnique({ where: { id } });
  }
  async duplicateCampaign(id: string) {
    const c = await this.db.marketingCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    return this.db.marketingCampaign.create({ data: { name: `${c.name} (copia)`.slice(0, 200), subject: c.subject, preheader: c.preheader, blocks: json(c.blocks), segmentId: c.segmentId } });
  }
  async deleteCampaign(id: string) {
    const result = await this.db.marketingCampaign.deleteMany({ where: { id, status: 'DRAFT' } });
    if (!result.count) throw new ConflictException('Solo se pueden borrar borradores.');
    return { deleted: true };
  }
  async launch(id: string, body: Record<string, any>) {
    this.requireReady();
    if (body.confirm !== true) throw new BadRequestException('Confirma el envío.');
    const dueAt = body.scheduledAt ? new Date(body.scheduledAt) : new Date();
    if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() < Date.now() - 60000 || dueAt.getTime() > Date.now() + 366 * 86400000) throw new BadRequestException('Fecha de envío inválida.');
    return this.db.$transaction(async tx => {
      const c = await tx.marketingCampaign.findUnique({ where: { id } });
      if (!c || c.status !== 'DRAFT') throw new ConflictException('Esta campaña ya se ha programado.');
      const segment = c.segmentId ? await tx.marketingSegment.findUnique({ where: { id: c.segmentId } }) : null;
      if (c.segmentId && !segment) throw new BadRequestException('No existe el segmento.');
      const contacts = await tx.marketingContact.findMany({ where: d.audienceWhere(segment?.rules as d.Rules | undefined), select: { id: true } });
      if (!contacts.length) throw new BadRequestException('No hay contactos suscritos en esta audiencia.');
      if (body.expectedRecipients !== contacts.length) throw new ConflictException(`La audiencia ha cambiado: ${contacts.length} destinatarios. Actualiza antes de confirmar.`);
      const claimed = await tx.marketingCampaign.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SCHEDULED', scheduledAt: dueAt } });
      if (!claimed.count) throw new ConflictException('Campaña ya programada.');
      const payload = json({ subject: c.subject, preheader: c.preheader, blocks: c.blocks });
      for (let offset = 0; offset < contacts.length; offset += 500) await tx.marketingMessage.createMany({ data: contacts.slice(offset, offset + 500).map(contact => ({ dedupeKey: `campaign:${id}:${contact.id}`, campaignId: id, contactId: contact.id, dueAt, payload })) });
      return { queued: contacts.length, scheduledAt: dueAt };
    }, { timeout: 60000 });
  }
  async cancel(id: string) {
    return this.db.$transaction(async tx => {
      const claimed = await tx.marketingCampaign.updateMany({ where: { id, status: { in: ['DRAFT', 'SCHEDULED'] } }, data: { status: 'CANCELLED' } });
      if (!claimed.count) throw new ConflictException('La campaña ya ha terminado o estaba cancelada.');
      const result = await tx.marketingMessage.updateMany({ where: { campaignId: id, status: 'QUEUED' }, data: { status: 'CANCELLED' } });
      return { cancelled: result.count };
    });
  }
  async retryMessage(id: string) {
    // Manual decision after reviewing an UNKNOWN/FAILED delivery: may duplicate if SMTP had accepted it.
    const result = await this.db.marketingMessage.updateMany({ where: { id, status: { in: ['FAILED', 'UNKNOWN'] } }, data: { status: 'QUEUED', dueAt: new Date(), claimedAt: null, error: null } });
    if (!result.count) throw new ConflictException('Solo se pueden reintentar mensajes fallidos o desconocidos.');
    return { queued: true };
  }

  // ── Flows ──
  async flows() {
    const items = await this.db.marketingFlow.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { messages: true } } } });
    return Promise.all(items.map(async f => ({ ...f, stats: await this.messageStats({ flowId: f.id }), queued: await this.db.marketingMessage.count({ where: { flowId: f.id, status: 'QUEUED' } }) })));
  }
  async saveFlow(body: Record<string, any>, id?: string) {
    const steps = d.steps(body.steps);
    if (await this.db.marketingTemplate.count({ where: { id: { in: [...new Set(steps.map(s => s.templateId))] } } }) !== new Set(steps.map(s => s.templateId)).size) throw new BadRequestException('Falta alguna plantilla.');
    const reentryDays = body.reentryDays == null ? 0 : Number(body.reentryDays);
    if (!Number.isInteger(reentryDays) || reentryDays < 0 || reentryDays > 365) throw new BadRequestException('Reentrada inválida: entre 0 y 365 días.');
    const data = { name: d.string(body.name, 'Nombre'), trigger: d.string(body.trigger, 'Evento', 100), stopOnEvent: d.stopEvents(d.string(body.stopOnEvent, 'Eventos de salida', 300, true)).join(', ') || null, steps: json(steps), transactional: body.transactional === true, reentryDays };
    if (!id) return this.db.marketingFlow.create({ data });
    const result = await this.db.marketingFlow.updateMany({ where: { id, status: 'DRAFT' }, data });
    if (!result.count) throw new ConflictException('Pausa la automatización antes de editarla.');
    return this.db.marketingFlow.findUnique({ where: { id } });
  }
  async flowStatus(id: string, live: boolean) {
    if (live) this.requireReady();
    return this.db.$transaction(async tx => {
      const flow = await tx.marketingFlow.update({ where: { id }, data: { status: live ? 'LIVE' : 'DRAFT' } });
      if (!live) await tx.marketingMessage.updateMany({ where: { flowId: id, status: 'QUEUED' }, data: { status: 'CANCELLED', error: 'Automatización pausada.' } });
      return flow;
    });
  }
  async deleteFlow(id: string) {
    const flow = await this.db.marketingFlow.findUnique({ where: { id }, include: { _count: { select: { messages: true } } } });
    if (!flow) throw new NotFoundException();
    if (flow.status !== 'DRAFT' || flow._count.messages) throw new ConflictException('Solo se pueden borrar automatizaciones en borrador sin envíos. Páusala para conservar su historial.');
    await this.db.marketingFlow.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Events ──
  async events() {
    const names = await this.db.marketingEvent.groupBy({ by: ['name'], _count: true, _max: { createdAt: true }, orderBy: { _count: { name: 'desc' } }, take: 50 });
    return Promise.all(names.map(async n => {
      const sample = await this.db.marketingEvent.findFirst({ where: { name: n.name }, orderBy: { createdAt: 'desc' }, select: { properties: true } });
      return { name: n.name, count: n._count, lastAt: n._max.createdAt, keys: Object.keys((sample?.properties ?? {}) as object).slice(0, 40) };
    }));
  }
  async ingestEvent(body: Record<string, any>) {
    const name = d.string(body.name, 'Evento', 100), externalId = d.string(body.externalId, 'Identificador único', 200), email = d.email(body.email);
    const properties = body.properties ?? {};
    if (typeof properties !== 'object' || Array.isArray(properties) || JSON.stringify(properties).length > 20000) throw new BadRequestException('Propiedades inválidas.');
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
    const value = money(body.value);
    try {
      return await this.db.$transaction(async tx => {
        const { contact } = await this.mergeContact(tx, { email, firstName: d.string(profile.firstName, 'Nombre', 100, true) || undefined, lastName: d.string(profile.lastName, 'Apellidos', 100, true) || undefined, country: d.string(profile.country, 'País', 100, true) || undefined }, { fillOnly: true });
        const since = new Date(Date.now() - this.attributionDays() * 86400000);
        const touch = name === 'Placed Order'
          ? await tx.marketingMessage.findFirst({ where: { contactId: contact.id, kind: 'MARKETING', clickedAt: { gte: since } }, orderBy: { clickedAt: 'desc' }, select: { id: true } })
            ?? await tx.marketingMessage.findFirst({ where: { contactId: contact.id, kind: 'MARKETING', openedAt: { gte: since } }, orderBy: { openedAt: 'desc' }, select: { id: true } })
          : null;
        const event = await tx.marketingEvent.create({ data: { externalId, name, contactId: contact.id, properties: json(properties), value: value ?? null, messageId: touch?.id ?? null } });
        const flows = ['BOUNCED', 'COMPLAINED'].includes(contact.status) ? [] : (await tx.marketingFlow.findMany({ where: { status: 'LIVE', trigger: name } })).filter(f => f.transactional || contact.status === 'SUBSCRIBED');
        let queued = 0;
        for (const flow of flows) {
          if (flow.reentryDays && await tx.marketingMessage.count({ where: { flowId: flow.id, contactId: contact.id, createdAt: { gte: new Date(Date.now() - flow.reentryDays * 86400000) } } })) continue;
          let delay = 0;
          for (const [i, step] of d.steps(flow.steps).entries()) {
            delay += step.delayMinutes;
            const t = await tx.marketingTemplate.findUnique({ where: { id: step.templateId } });
            if (!t) continue;
            await tx.marketingMessage.create({ data: { dedupeKey: `flow:${flow.id}:${event.id}:${i}`, kind: flow.transactional ? 'TRANSACTIONAL' : 'MARKETING', contactId: contact.id, flowId: flow.id, dueAt: new Date(event.createdAt.getTime() + delay * 60000), payload: json({ subject: t.subject, preheader: t.preheader, blocks: t.blocks, event: properties, eventId: event.id, eventAt: event.createdAt.toISOString(), stopOnEvent: flow.stopOnEvent, ...(step.onlyIf ? { onlyIf: step.onlyIf } : {}) }) } });
            queued++;
          }
        }
        return { id: event.id, queued, duplicate: false, attributed: Boolean(touch) };
      });
    } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { duplicate: true, queued: 0 }; throw e; }
  }
  /** Internal producers (Mitaller returns, crew…) mirror their Klaviyo events here when MARKETING_CAPTURE_EVENTS=true. */
  async captureInternal(name: string, email: string, properties: Record<string, unknown>) {
    if (this.env('CAPTURE_EVENTS') !== 'true') return;
    const day = new Date().toISOString().slice(0, 10);
    const externalId = `mitaller:${createHash('sha256').update(`${name}|${email}|${JSON.stringify(properties)}|${day}`).digest('hex')}`;
    try { await this.ingestEvent({ name, email, externalId, properties }); } catch (e) { this.logger.warn(`Evento interno «${name}» no registrado: ${e instanceof Error ? e.message : e}`); }
  }
  private emitSubscribed(contact: { id: string; email: string }, source: string) {
    // Welcome flows trigger on "Subscribed"; the externalId makes it fire once per contact, ever.
    return this.ingestEvent({ name: 'Subscribed', email: contact.email, externalId: `subscribed:${contact.id}`, properties: { source } }).catch(e => this.logger.warn(`Subscribed no registrado: ${e}`));
  }

  // ── Forms and public endpoints ──
  forms() { return this.db.marketingForm.findMany({ orderBy: { createdAt: 'desc' } }); }
  saveForm(body: Record<string, any>, id?: string) {
    if (body.active === true) this.requireReady();
    const data = { name: d.string(body.name, 'Nombre'), headline: d.string(body.headline, 'Título'), description: d.string(body.description, 'Descripción', 1000), buttonText: d.string(body.buttonText, 'Botón', 60), tag: d.string(body.tag, 'Etiqueta', 60), active: body.active === true };
    return id ? this.db.marketingForm.update({ where: { id }, data }) : this.db.marketingForm.create({ data });
  }
  async publicForm(id: string) { const form = await this.db.marketingForm.findUnique({ where: { id } }); if (!form?.active || !this.settings().ready) throw new NotFoundException('Formulario no disponible.'); return form; }
  async subscribe(id: string, body: Record<string, any>) {
    const form = await this.publicForm(id);
    if (body.website) return { ok: true };
    if (body.consent !== 'yes' && body.consent !== true && body.consent !== 'on') throw new BadRequestException('Acepta la suscripción para continuar.');
    const email = d.email(body.email);
    const firstName = d.string(body.firstName, 'Nombre', 100, true);
    await this.db.$transaction(async tx => {
      const c = await tx.marketingContact.upsert({ where: { email }, create: { email, firstName }, update: {} });
      const tags = [...new Set([...c.tags, form.tag])].slice(0, 30);
      if (['SUBSCRIBED', 'BOUNCED', 'COMPLAINED'].includes(c.status) || (c.confirmExpiresAt && c.confirmExpiresAt.getTime() - 23 * 3600000 > Date.now())) {
        if (c.status === 'SUBSCRIBED') await tx.marketingContact.update({ where: { id: c.id }, data: { tags } });
        return;
      }
      const token = randomUUID();
      await tx.marketingContact.update({ where: { id: c.id }, data: { confirmToken: token, confirmExpiresAt: new Date(Date.now() + 86400000), tags, firstName: c.firstName || firstName, consentSource: `form:${id}` } });
      const link = `${this.env('PUBLIC_API_URL')}/marketing/public/confirm/${token}`;
      await tx.marketingMessage.create({ data: { dedupeKey: `confirm:${token}`, kind: 'CONFIRMATION', contactId: c.id, payload: json({ subject: 'Confirma tu suscripción a Speedwear', preheader: 'Un último paso para estar dentro.', blocks: [{ type: 'heading', text: 'Estás a un paso.' }, { type: 'text', text: 'Confirma que quieres recibir novedades y ofertas de Speedwear. Si no has solicitado la suscripción, ignora este correo.' }, { type: 'button', text: 'Confirmar mi suscripción', url: link }], confirmToken: token }) } });
    });
    return { ok: true };
  }
  async confirm(token: string) {
    const contact = await this.db.$transaction(async tx => {
      const c = await tx.marketingContact.findUnique({ where: { confirmToken: token } });
      if (!c || !c.confirmExpiresAt || c.confirmExpiresAt < new Date() || ['BOUNCED', 'COMPLAINED'].includes(c.status)) throw new BadRequestException('Enlace caducado o no válido.');
      return tx.marketingContact.update({ where: { id: c.id }, data: { status: 'SUBSCRIBED', consentAt: new Date(), confirmToken: null, confirmExpiresAt: null } });
    });
    await this.emitSubscribed(contact, contact.consentSource ?? 'form');
    return { ok: true };
  }
  async unsubscribe(token: string, messageToken?: string) {
    return this.db.$transaction(async tx => {
      const c = await tx.marketingContact.findUnique({ where: { unsubscribeToken: token } });
      if (!c) throw new NotFoundException('Enlace no válido.');
      await tx.marketingContact.update({ where: { id: c.id }, data: { status: ['BOUNCED', 'COMPLAINED'].includes(c.status) ? c.status : 'UNSUBSCRIBED', confirmToken: null, confirmExpiresAt: null } });
      await tx.marketingMessage.updateMany({ where: { contactId: c.id, kind: { not: 'TRANSACTIONAL' }, status: 'QUEUED' }, data: { status: 'SKIPPED', error: 'Baja del contacto.' } });
      if (messageToken) await tx.marketingMessage.updateMany({ where: { trackingToken: messageToken, contactId: c.id, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
      return { ok: true };
    });
  }
  private siteDomains() { return (this.env('SITE_DOMAINS') || 'speedwear.es').split(',').map(s => s.trim().toLowerCase()).filter(Boolean); }
  async track(token: string, type: 'open' | 'click', index = 0) {
    const message = await this.db.marketingMessage.findUnique({ where: { trackingToken: token }, include: { contact: true } });
    if (!message?.sentAt || !tracked.includes(message.kind)) return null;
    let url: string | undefined;
    if (type === 'click') {
      url = d.renderEmail(message.payload as d.MessagePayload, message.contact).links[index];
      if (!url) return null;
      // Lets the onsite script attribute product views to this contact (browse abandonment).
      const target = new URL(url);
      if (this.siteDomains().some(h => target.hostname === h || target.hostname.endsWith(`.${h}`))) { target.searchParams.set('swm', token); url = target.toString(); }
    }
    const field = type === 'open' ? 'openedAt' : 'clickedAt';
    await this.db.marketingMessage.updateMany({ where: { id: message.id, [field]: null }, data: { [field]: new Date() } });
    if (type === 'click') await this.db.marketingMessage.updateMany({ where: { id: message.id, openedAt: null }, data: { openedAt: new Date() } });
    return url ?? true;
  }
  async activity(body: Record<string, any>) {
    const token = d.string(body.token, 'Token', 64);
    const name = body.type === 'Added to Cart' ? 'Added to Cart' : 'Viewed Product';
    const p = body.product && typeof body.product === 'object' ? body.product : null;
    if (!p) throw new BadRequestException('Producto requerido.');
    const message = await this.db.marketingMessage.findUnique({ where: { trackingToken: token }, select: { contact: { select: { id: true, email: true } } } });
    if (!message) return { ok: true };
    const productId = d.string(String(p.id ?? ''), 'Producto', 60);
    const title = d.string(p.title, 'Título', 300, true);
    // itemsText matches the cart summary that imported Klaviyo cart templates now show.
    const properties = { productId, title, itemsText: title, url: d.safeUrl(String(p.url ?? '')), image: d.safeUrl(String(p.image ?? '')), price: d.string(String(p.price ?? ''), 'Precio', 30, true) };
    await this.ingestEvent({ name, email: message.contact.email, externalId: `${name === 'Added to Cart' ? 'cart' : 'view'}:${message.contact.id}:${productId}:${new Date().toISOString().slice(0, 10)}`, properties });
    return { ok: true };
  }

  // ── Provider feedback (bounces, complaints) ──
  private assertSecret(given: unknown) {
    const secret = this.env('EVENT_SECRET');
    const a = Buffer.from(String(given ?? '')), b = Buffer.from(secret);
    if (secret.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Secreto de integración no válido.');
  }
  async integrationEvent(secret: unknown, body: Record<string, any>) { this.assertSecret(secret); return this.ingestEvent(body); }
  async integrationFeedback(secret: unknown, body: Record<string, any>) { this.assertSecret(secret); return this.feedback(body); }
  /** Lets an operator script run the Klaviyo migration with the integration secret; it only creates drafts and never sends. */
  async integrationMigration(secret: unknown, action: 'package' | 'klaviyo' | 'status' | 'summary', body: Record<string, any> = {}) {
    this.assertSecret(secret);
    if (action === 'package') return this.importPackage(body);
    if (action === 'klaviyo') return this.importFromKlaviyo(body);
    if (action === 'status') return this.klaviyoImportStatus();
    const [templates, flows, segments, tagged] = await Promise.all([
      this.db.marketingTemplate.count(),
      this.db.marketingFlow.findMany({ orderBy: { name: 'asc' }, select: { name: true, status: true, trigger: true, stopOnEvent: true, transactional: true, steps: true } }),
      this.db.marketingSegment.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
      this.db.$queryRaw<Array<{ tag: string; count: bigint }>>`SELECT tag, COUNT(*) AS count FROM "MarketingContact", unnest(tags) AS tag WHERE tag LIKE 'lista:%' OR tag LIKE 'segmento:%' GROUP BY tag ORDER BY tag`
    ]);
    const recentEvents = await this.db.marketingEvent.groupBy({ by: ['name'], where: { createdAt: { gte: new Date(Date.now() - 86400000) } }, _count: true });
    return { templates, flows: flows.map(f => ({ ...f, steps: (f.steps as unknown[]).length })), segments: segments.map(s => s.name), tags: tagged.map(t => ({ tag: t.tag, count: Number(t.count) })), placedOrders: await this.db.marketingEvent.count({ where: { name: 'Placed Order' } }), shopifySync: this.shopifySync, eventsLast24h: Object.fromEntries(recentEvents.map(e => [e.name, e._count])) };
  }
  async feedback(body: Record<string, any>) {
    const ids = (Array.isArray(body.providerMessageIds) ? body.providerMessageIds : [body.providerMessageId]).map(stripId).filter(Boolean).slice(0, 5);
    const event = body.event;
    if (!ids.length) throw new BadRequestException('ID del mensaje requerido.');
    if (!['delivered', 'bounce', 'complaint'].includes(event)) throw new BadRequestException('Evento inválido.');
    // Our own Message-ID is <messageId@domain>; providers that rewrite it still echo the original header.
    const localIds = ids.map((id: string) => id.split('@')[0]).filter((id: string) => /^c[a-z0-9]{20,}$/.test(id));
    return this.db.$transaction(async tx => {
      const message = await tx.marketingMessage.findFirst({ where: { OR: [{ providerMessageId: { in: ids } }, ...(localIds.length ? [{ id: { in: localIds } }] : [])] } });
      if (!message) throw new NotFoundException('Mensaje no encontrado.');
      if (event === 'delivered') await tx.marketingMessage.updateMany({ where: { id: message.id, status: 'SENT' }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      else {
        const status = event === 'bounce' ? 'BOUNCED' : 'COMPLAINED';
        await tx.marketingMessage.update({ where: { id: message.id }, data: { status } });
        await tx.marketingContact.updateMany({ where: { id: message.contactId, ...(event === 'bounce' ? { status: { not: 'COMPLAINED' } } : {}) }, data: { status, confirmToken: null, confirmExpiresAt: null } });
        await tx.marketingMessage.updateMany({ where: { contactId: message.contactId, status: 'QUEUED' }, data: { status: 'SKIPPED', error: status } });
      }
      return { ok: true };
    });
  }
  /** Amazon SES notifications delivered through an SNS HTTPS subscription. */
  async sesNotification(secret: string, raw: string) {
    this.assertSecret(secret);
    let msg: any;
    try { msg = JSON.parse(raw); } catch { throw new BadRequestException('JSON inválido.'); }
    if (msg.Type === 'SubscriptionConfirmation') {
      const url = new URL(String(msg.SubscribeURL ?? ''));
      if (url.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) throw new BadRequestException('URL de suscripción SNS no válida.');
      const res = await fetch(url);
      return { ok: res.ok, subscribed: true };
    }
    if (msg.Type !== 'Notification') return { ok: true, ignored: true };
    let n: any;
    try { n = JSON.parse(msg.Message); } catch { return { ok: true, ignored: true }; }
    const type = n.notificationType ?? n.eventType;
    const event = type === 'Delivery' ? 'delivered' : type === 'Complaint' ? 'complaint' : type === 'Bounce' && n.bounce?.bounceType === 'Permanent' ? 'bounce' : null;
    const ids = [n.mail?.messageId, n.mail?.commonHeaders?.messageId].map(stripId).filter(Boolean);
    if (!event || !ids.length) return { ok: true, ignored: true };
    try { return await this.feedback({ providerMessageIds: ids, event }); } catch (e) { if (e instanceof NotFoundException) return { ok: true, ignored: true }; throw e; }
  }

  // ── Shopify ──
  async shopifyWebhook(topic: string | undefined, hmac: string | undefined, rawBody: Buffer | undefined, payload: any) {
    const secret = this.config.get<string>('SHOPIFY_WEBHOOK_SECRET');
    if (!secret || !rawBody || !hmac) throw new UnauthorizedException('Firma webhook Shopify ausente');
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('base64')), received = Buffer.from(hmac);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new UnauthorizedException('Firma webhook Shopify no valida');
    return this.handleShopify(topic, payload);
  }
  /** Shared by webhooks and the polling sync: Shopify's REST objects have the webhook payload shape. */
  private async handleShopify(topic: string | undefined, payload: any) {
    const email = String(payload?.email ?? payload?.contact_email ?? payload?.customer?.email ?? '').trim().toLowerCase();
    if (!email || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) return { received: true, ignored: true };
    const customer = topic?.startsWith('customers/') ? payload : payload?.customer ?? {};
    const address = payload?.shipping_address ?? payload?.billing_address ?? customer?.default_address ?? {};
    const profile = { firstName: String(customer?.first_name ?? address?.first_name ?? '').slice(0, 100), lastName: String(customer?.last_name ?? address?.last_name ?? '').slice(0, 100), country: String(address?.country_code ?? '').slice(0, 100) };
    const items = Array.isArray(payload?.line_items) ? payload.line_items.slice(0, 20) : [];
    const itemsText = items.map((i: any) => `${i.quantity ?? 1}× ${i.title ?? ''}${i.variant_title ? ` (${i.variant_title})` : ''}`).join(', ').slice(0, 1500);
    await this.shopifyConsent(email, customer?.email_marketing_consent, topic?.startsWith('customers/') ? payload?.accepts_marketing : payload?.buyer_accepts_marketing, profile);
    switch (topic) {
      case 'checkouts/create':
      case 'checkouts/update':
        if (payload.completed_at || !payload.token) return { received: true, ignored: true };
        return this.ingestEvent({ name: 'Started Checkout', email, externalId: `shopify:checkout:${payload.token}`, value: payload.total_price, profile, properties: { checkoutUrl: d.safeUrl(String(payload.abandoned_checkout_url ?? '')), total: String(payload.total_price ?? ''), currency: String(payload.currency ?? 'EUR'), itemsText, itemCount: items.length } });
      case 'orders/create':
        return this.ingestEvent({ name: 'Placed Order', email, externalId: `shopify:order:${payload.id}`, value: payload.total_price, profile, properties: { orderName: String(payload.name ?? ''), orderNumber: String(payload.order_number ?? payload.name ?? '').replace(/^#/, ''), total: String(payload.total_price ?? ''), currency: String(payload.currency ?? 'EUR'), itemsText, itemCount: items.length, orderStatusUrl: d.safeUrl(String(payload.order_status_url ?? '')) } });
      case 'orders/fulfilled': {
        const f = Array.isArray(payload.fulfillments) ? payload.fulfillments[payload.fulfillments.length - 1] ?? {} : {};
        return this.ingestEvent({ name: 'Fulfilled Order', email, externalId: `shopify:fulfilled:${payload.id}`, profile, properties: { orderName: String(payload.name ?? ''), itemsText, trackingNumber: String(f.tracking_number ?? ''), trackingUrl: d.safeUrl(String(f.tracking_url ?? '')), orderStatusUrl: d.safeUrl(String(payload.order_status_url ?? '')) } });
      }
      case 'orders/cancelled':
        return this.ingestEvent({ name: 'Cancelled Order', email, externalId: `shopify:cancelled:${payload.id}`, profile, properties: { orderName: String(payload.name ?? ''), reason: String(payload.cancel_reason ?? '') } });
      default:
        return { received: true };
    }
  }
  private shopifyCursor = new Date(Date.now() - 15 * 60000);
  private shopifySync: { at?: string; ok?: boolean; error?: string; orders: number; checkouts: number; customers: number } = { orders: 0, checkouts: 0, customers: 0 };
  private syncing = false;
  shopifySyncStatus() { return this.shopifySync; }
  private async shopifyGet(path: string): Promise<{ body: any; next: string | null }> {
    const domain = String(this.config.get('SHOPIFY_SHOP_DOMAIN') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const res = await fetch(path.startsWith('https://') ? path : `https://${domain}/admin/api/${this.config.get<string>('SHOPIFY_API_VERSION') ?? '2026-04'}${path}`, { headers: { 'X-Shopify-Access-Token': String(this.config.get('SHOPIFY_ADMIN_ACCESS_TOKEN') ?? '') }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Shopify ${res.status} en ${path.split('?')[0].slice(-40)}: ${(await res.text()).slice(0, 200)}`);
    return { body: await res.json(), next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null };
  }
  /** Polls Shopify every 5 minutes so marketing works without registering webhooks; externalIds dedupe against webhooks. */
  @Cron('15 */5 * * * *')
  async syncShopify() {
    if (this.syncing || this.env('SHOPIFY_SYNC') === 'false' || !this.config.get('SHOPIFY_SHOP_DOMAIN') || !this.config.get('SHOPIFY_ADMIN_ACCESS_TOKEN')) return;
    this.syncing = true;
    const since = new Date(this.shopifyCursor.getTime() - 60000), startedAt = new Date();
    const counts = { orders: 0, checkouts: 0, customers: 0 }, errors: string[] = [];
    const each = async (path: string, key: 'orders' | 'checkouts' | 'customers', handle: (item: any) => Promise<unknown>) => {
      try {
        let url: string | null = path;
        while (url) {
          const { body, next } = await this.shopifyGet(url);
          for (const item of body[key] ?? []) { try { await handle(item); counts[key]++; } catch (e) { this.logger.warn(`Shopify ${key} ${item?.id}: ${e instanceof Error ? e.message : e}`); } }
          url = next;
        }
      } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    };
    try {
      const min = encodeURIComponent(since.toISOString());
      await each(`/orders.json?status=any&limit=250&updated_at_min=${min}`, 'orders', async o => {
        // Only orders created while syncing count as new purchases; older ones came from Klaviyo's history.
        if (new Date(o.created_at) >= since) await this.handleShopify('orders/create', o);
        if (o.fulfillment_status === 'fulfilled') await this.handleShopify('orders/fulfilled', o);
        if (o.cancelled_at) await this.handleShopify('orders/cancelled', o);
      });
      await each(`/checkouts.json?limit=250&updated_at_min=${min}`, 'checkouts', c => this.handleShopify('checkouts/update', c));
      await each(`/customers.json?limit=250&updated_at_min=${min}`, 'customers', c => this.handleShopify('customers/update', c));
      // The cursor always advances: a resource that keeps failing (missing scope) must not stall the others.
      this.shopifyCursor = startedAt;
      this.shopifySync = { at: startedAt.toISOString(), ok: !errors.length, ...(errors.length ? { error: errors.join(' · ').slice(0, 500) } : {}), ...counts };
      if (errors.length) this.logger.error(`Sincronización Shopify: ${this.shopifySync.error}`);
    } finally { this.syncing = false; }
  }
  private async shopifyConsent(email: string, consent: any, acceptsMarketing: unknown, profile: { firstName: string; lastName: string; country: string }) {
    const state = typeof consent?.state === 'string' ? consent.state : acceptsMarketing === true ? 'subscribed' : null;
    const status = state === 'subscribed' ? 'SUBSCRIBED' : state === 'unsubscribed' ? 'UNSUBSCRIBED' : undefined;
    const parsed = consent?.consent_updated_at ? new Date(consent.consent_updated_at) : new Date();
    const consentAt = Number.isFinite(parsed.getTime()) ? parsed : new Date();
    const { contact, subscribedNow } = await this.db.$transaction(tx => this.mergeContact(tx, { email, ...profile, status, consentAt, consentSource: 'shopify' }, { fillOnly: true }));
    // Old Shopify subscribers seen for the first time (before or without the Klaviyo import) must not get the welcome series.
    if (subscribedNow && consentAt.getTime() > Date.now() - 2 * 86400000) await this.emitSubscribed(contact, 'shopify');
  }

  // ── Klaviyo migration ──
  klaviyoImportStatus() { return this.klaviyoJob; }
  importFromKlaviyo(body: Record<string, any> = {}) {
    const key = this.config.get<string>('KLAVIYO_API_KEY')?.trim();
    if (!key) throw new BadRequestException('Falta KLAVIYO_API_KEY.');
    if (this.klaviyoJob.running) throw new ConflictException('La importación ya está en marcha.');
    const all: ImportPart[] = ['profiles', 'lists', 'segments', 'orders'];
    const parts = Array.isArray(body.parts) ? all.filter(p => body.parts.includes(p)) : all;
    if (!parts.length) throw new BadRequestException('Elige qué importar.');
    this.klaviyoJob = { running: true, processed: 0, imported: 0, skipped: 0, parts, lists: 0, segments: 0, orders: 0, startedAt: new Date().toISOString() };
    void this.runKlaviyoImport(key, parts)
      .catch(e => { this.klaviyoJob.error = e instanceof Error ? e.message : String(e); })
      .finally(() => { this.klaviyoJob.running = false; this.klaviyoJob.stage = undefined; this.klaviyoJob.finishedAt = new Date().toISOString(); });
    return this.klaviyoJob;
  }
  private async klaviyoPages(key: string, url: string | null, each: (page: { data?: any[]; included?: any[] }) => Promise<void>) {
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Klaviyo-API-Key ${key}`, accept: 'application/vnd.api+json', revision: '2024-10-15' } });
      if (res.status === 429) { await new Promise(r => setTimeout(r, Math.min(60, Number(res.headers.get('retry-after')) || 5) * 1000)); continue; }
      if (!res.ok) throw new Error(`Klaviyo respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const page = await res.json() as { data?: any[]; included?: any[]; links?: { next?: string | null } };
      await each(page);
      url = page.links?.next ?? null;
    }
  }
  private async runKlaviyoImport(key: string, parts: ImportPart[]) {
    const api = 'https://a.klaviyo.com/api';
    const job = this.klaviyoJob;
    if (parts.includes('profiles')) {
      job.stage = 'Contactos';
      await this.klaviyoPages(key, `${api}/profiles/?additional-fields%5Bprofile%5D=subscriptions&page%5Bsize%5D=100`, async page => {
        for (const profile of page.data ?? []) {
          job.processed++;
          const input = klaviyoContact(profile);
          if (!input) { job.skipped++; continue; }
          // Existing subscribers are migrated silently: no "Subscribed" event, so welcome flows do not fire.
          await this.db.$transaction(tx => this.mergeContact(tx, input, { mergeTags: true, fillOnly: true }));
          job.imported++;
        }
      });
    }
    // List and segment membership become tags (a snapshot); each Klaviyo segment also gets a segment here filtering by its tag.
    for (const kind of ['lists', 'segments'] as const) {
      if (!parts.includes(kind)) continue;
      const groups: { id: string; name: string }[] = [];
      await this.klaviyoPages(key, `${api}/${kind}/?fields%5B${kind.slice(0, -1)}%5D=name`, async page => { groups.push(...(page.data ?? []).map(g => ({ id: g.id, name: String(g.attributes?.name ?? g.id).slice(0, 50) }))); });
      for (const group of groups) {
        job.stage = `${kind === 'lists' ? 'Lista' : 'Segmento'} «${group.name}»`;
        const tag = `${kind === 'lists' ? 'lista' : 'segmento'}:${group.name}`;
        await this.klaviyoPages(key, `${api}/${kind}/${group.id}/profiles/?fields%5Bprofile%5D=email&page%5Bsize%5D=100`, async page => {
          const emails = (page.data ?? []).map(p => String(p.attributes?.email ?? '').trim().toLowerCase()).filter(e => e.includes('@'));
          if (emails.length) await this.db.marketingContact.updateMany({ where: { email: { in: emails }, NOT: { tags: { has: tag } } }, data: { tags: { push: tag } } });
        });
        if (kind === 'segments' && !await this.db.marketingSegment.count({ where: { name: `${group.name} (Klaviyo)` } })) {
          await this.db.marketingSegment.create({ data: { name: `${group.name} (Klaviyo)`, rules: json({ mode: 'all', conditions: [{ field: 'tag', operator: 'is', value: tag }] }) } });
        }
        job[kind]!++;
      }
    }
    // Order history makes "first order vs repeat", winback and buyer segments work from day one. Historic events never trigger flows.
    if (parts.includes('orders')) {
      job.stage = 'Historial de pedidos';
      let metricId = '';
      await this.klaviyoPages(key, `${api}/metrics/`, async page => { metricId ||= (page.data ?? []).find(m => m.attributes?.name === 'Placed Order' && m.attributes?.integration?.key === 'shopify')?.id ?? ''; });
      if (!metricId) throw new Error('No hay métrica «Placed Order» de Shopify en Klaviyo.');
      const filter = encodeURIComponent(`equals(metric_id,"${metricId}")`);
      await this.klaviyoPages(key, `${api}/events/?filter=${filter}&include=profile&fields%5Bprofile%5D=email&fields%5Bevent%5D=datetime,event_properties,uuid&page%5Bsize%5D=200`, async page => {
        const emails = new Map((page.included ?? []).filter(i => i.type === 'profile').map(i => [i.id, String(i.attributes?.email ?? '').toLowerCase()]));
        const contacts = new Map((await this.db.marketingContact.findMany({ where: { email: { in: [...emails.values()].filter(Boolean) } }, select: { id: true, email: true } })).map(c => [c.email, c.id]));
        const rows = (page.data ?? []).flatMap(e => {
          const contactId = contacts.get(emails.get(e.relationships?.profile?.data?.id) ?? '');
          const at = new Date(e.attributes?.datetime);
          if (!contactId || !Number.isFinite(at.getTime())) return [];
          const props = e.attributes?.event_properties ?? {};
          const name = String(props.extra?.name ?? props.OrderId ?? '');
          return [{ externalId: `klaviyo:${e.attributes?.uuid ?? e.id}`, contactId, name: 'Placed Order', createdAt: at, value: money(props.$value) ?? null, properties: json({ orderName: name, orderNumber: name.replace(/^#/, ''), total: String(props.$value ?? ''), source: 'klaviyo' }) }];
        });
        if (rows.length) job.orders! += (await this.db.marketingEvent.createMany({ data: rows, skipDuplicates: true })).count;
      });
    }
  }
  private async klaviyoTemplateHtml(id: string) {
    const key = this.config.get<string>('KLAVIYO_API_KEY')?.trim();
    if (!key) throw new BadRequestException('Falta KLAVIYO_API_KEY para descargar las plantillas.');
    const res = await fetch(`https://a.klaviyo.com/api/templates/${encodeURIComponent(id)}/?fields%5Btemplate%5D=html`, { headers: { Authorization: `Klaviyo-API-Key ${key}`, accept: 'application/vnd.api+json', revision: '2024-10-15' } });
    if (!res.ok) throw new BadRequestException(`Klaviyo no devolvió la plantilla ${id} (${res.status}).`);
    return String(((await res.json()) as any)?.data?.attributes?.html ?? '');
  }
  /** Templates and flows exported from Klaviyo (built from its API). Everything lands as draft; names already present are skipped. */
  async importPackage(body: Record<string, any>) {
    const templates = Array.isArray(body.templates) ? body.templates.slice(0, 200) : [];
    const flows = Array.isArray(body.flows) ? body.flows.slice(0, 50) : [];
    if (!templates.length && !flows.length) throw new BadRequestException('El archivo no contiene plantillas ni automatizaciones.');
    const ids = new Map<string, string>(), warnings: string[] = [];
    let createdTemplates = 0, createdFlows = 0;
    for (const t of templates) {
      const key = d.string(String(t.key ?? ''), 'Clave de plantilla', 100);
      const name = d.string(t.name, 'Nombre de plantilla', 200);
      const html = typeof t.html === 'string' && t.html ? t.html : await this.klaviyoTemplateHtml(d.string(String(t.klaviyoTemplateId ?? ''), 'Plantilla de Klaviyo', 50));
      const converted = d.fromKlaviyo(d.string(html, 'HTML', d.htmlBlockMax));
      converted.warnings.forEach(w => warnings.push(`${name}: ${w}`));
      const data = { name, subject: d.fromKlaviyo(d.string(t.subject, 'Asunto', 300)).html.slice(0, 200), preheader: d.fromKlaviyo(d.string(t.preheader ?? '', 'Preencabezado', 300, true)).html.slice(0, 200), blocks: json(d.blocks([{ type: 'html', text: converted.html }])) };
      const existing = await this.db.marketingTemplate.findFirst({ where: { name }, select: { id: true } });
      // replace=true re-applies the conversion to templates imported earlier (used while improving the converter).
      if (existing) { ids.set(key, existing.id); if (body.replace === true) { await this.db.marketingTemplate.update({ where: { id: existing.id }, data }); createdTemplates++; } continue; }
      const created = await this.db.marketingTemplate.create({ data });
      ids.set(key, created.id); createdTemplates++;
    }
    for (const f of flows) {
      const name = d.string(f.name, 'Nombre de automatización', 200);
      const existingFlow = await this.db.marketingFlow.findFirst({ where: { name }, select: { id: true, status: true } });
      if (existingFlow && (body.replace !== true || existingFlow.status !== 'DRAFT')) continue;
      const steps = (Array.isArray(f.steps) ? f.steps : []).filter((s: any) => ids.has(String(s.templateKey))).map((s: any) => ({ delayMinutes: s.delayMinutes, templateId: ids.get(String(s.templateKey)), ...(s.onlyIf ? { onlyIf: s.onlyIf } : {}) }));
      if (!steps.length) { warnings.push(`${name}: sin plantillas, no se ha creado.`); continue; }
      const flowData = { name, trigger: d.string(f.trigger, 'Evento', 100), stopOnEvent: d.stopEvents(d.string(f.stopOnEvent ?? '', 'Eventos de salida', 300, true)).join(', ') || null, transactional: f.transactional === true, reentryDays: Number.isInteger(f.reentryDays) ? Math.min(365, Math.max(0, f.reentryDays)) : 0, steps: json(d.steps(steps)) };
      if (existingFlow) await this.db.marketingFlow.update({ where: { id: existingFlow.id }, data: flowData });
      else await this.db.marketingFlow.create({ data: flowData });
      createdFlows++;
      if (typeof f.notes === 'string' && f.notes) warnings.push(`${name}: ${f.notes.slice(0, 300)}`);
    }
    return { templates: createdTemplates, flows: createdFlows, skippedTemplates: templates.length - createdTemplates, warnings };
  }

  // ── Delivery queue ──
  @Cron('*/30 * * * * *')
  async drain() {
    if (this.working || !this.settings().ready) return;
    this.working = true;
    let transport: Transport | undefined;
    try {
      await this.db.marketingMessage.updateMany({ where: { status: 'SENDING', claimedAt: { lt: new Date(Date.now() - 15 * 60000) } }, data: { status: 'UNKNOWN', error: 'Resultado SMTP desconocido. Requiere revisión; no se reenvía automáticamente.' } });
      // Confirmations and transactional mail go first so a big campaign never delays a return label.
      const urgent = await this.db.marketingMessage.findMany({ where: { status: 'QUEUED', kind: { not: 'MARKETING' }, dueAt: { lte: new Date() } }, take: this.batchSize(), orderBy: { dueAt: 'asc' }, select: { id: true } });
      const due = urgent.length >= this.batchSize() ? urgent : [...urgent, ...await this.db.marketingMessage.findMany({ where: { status: 'QUEUED', kind: 'MARKETING', dueAt: { lte: new Date() } }, take: this.batchSize() - urgent.length, orderBy: { dueAt: 'asc' }, select: { id: true } })];
      if (due.length) {
        transport = this.transport();
        for (let offset = 0; offset < due.length; offset += 3) await Promise.all(due.slice(offset, offset + 3).map(m => this.deliver(m.id, transport!)));
      }
      const campaigns = await this.db.marketingCampaign.findMany({ where: { status: 'SCHEDULED' }, select: { id: true } });
      for (const c of campaigns) if (!await this.db.marketingMessage.count({ where: { campaignId: c.id, status: { notIn: terminal } } })) await this.db.marketingCampaign.updateMany({ where: { id: c.id, status: 'SCHEDULED' }, data: { status: 'FINISHED' } });
    } catch (e) { this.logger.error(`Cola de marketing: ${e instanceof Error ? e.message : e}`); } finally { transport?.close(); this.working = false; }
  }
  /** "Only if Placed Order = 0 since the flow started" and similar Klaviyo conditional splits. */
  private async stepConditionHolds(contactId: string, p: d.MessagePayload) {
    const c = p.onlyIf!;
    const createdAt = c.since === 'flow' && p.eventAt ? { gte: new Date(p.eventAt) } : c.since === 'days' ? { gte: new Date(Date.now() - (c.days ?? 1) * 86400000) } : undefined;
    const count = await this.db.marketingEvent.count({ where: { contactId, name: c.event, ...(createdAt ? { createdAt } : {}), ...(c.since === 'flow' && p.eventId ? { id: { not: p.eventId } } : {}) } });
    return c.op === 'eq' ? count === c.value : count > c.value;
  }
  private async deliver(id: string, transport: Transport) {
    const claim = await this.db.marketingMessage.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'SENDING', claimedAt: new Date() } });
    if (!claim.count) return;
    const m = await this.db.marketingMessage.findUniqueOrThrow({ where: { id }, include: { contact: true, campaign: true, flow: true } });
    const p = m.payload as d.MessagePayload & { confirmToken?: string };
    // The triggering event itself never counts as the exit event (winback flows trigger and stop on "Placed Order").
    const exits = m.kind !== 'CONFIRMATION' ? d.stopEvents(p.stopOnEvent) : [];
    const sinceTrigger = (name: string | { in: string[] }) => ({ contactId: m.contactId, name, createdAt: { gte: new Date(p.eventAt!) }, ...(p.eventId ? { id: { not: p.eventId } } : {}) });
    const stop = exits.length && p.eventAt ? await this.db.marketingEvent.count({ where: sinceTrigger({ in: exits }) }) : 0;
    const conditionFails = p.onlyIf && m.kind !== 'CONFIRMATION' ? !(await this.stepConditionHolds(m.contactId, p)) : false;
    const hardSuppressed = ['BOUNCED', 'COMPLAINED'].includes(m.contact.status);
    if (!stop && conditionFails) { await this.db.marketingMessage.update({ where: { id }, data: { status: 'SKIPPED', error: 'No cumple la condición del paso.' } }); return; }
    const invalid = m.kind === 'MARKETING' ? m.contact.status !== 'SUBSCRIBED' || m.campaign?.status === 'CANCELLED' || (m.flow && m.flow.status !== 'LIVE') || stop
      : m.kind === 'TRANSACTIONAL' ? hardSuppressed || (m.flow && m.flow.status !== 'LIVE') || stop
      : hardSuppressed || m.contact.confirmToken !== p.confirmToken || !m.contact.confirmExpiresAt || m.contact.confirmExpiresAt < new Date();
    if (invalid) { await this.db.marketingMessage.update({ where: { id }, data: { status: 'SKIPPED', error: 'Contacto, campaña o automatización ya no elegible.' } }); return; }
    const base = `${this.env('PUBLIC_API_URL')}/marketing/public`, unsubscribeUrl = `${base}/unsubscribe/${m.contact.unsubscribeToken}?m=${m.trackingToken}`;
    const marketing = m.kind === 'MARKETING';
    const rendered = d.renderEmail(p, m.contact, { address: this.env('POSTAL_ADDRESS'), ...(marketing ? { unsubscribeUrl } : {}), ...(tracked.includes(m.kind) ? { pixelUrl: `${base}/open/${m.trackingToken}`, trackLink: (_: string, index: number) => `${base}/click/${m.trackingToken}/${index}` } : {}) });
    let accepted = false;
    try {
      const info = await transport.sendMail({ from: this.from(), to: m.contact.email, subject: d.personalize(p.subject, m.contact, p.event).replace(/[\r\n]/g, ' '), html: rendered.html, text: rendered.text, messageId: `<${m.id}@${this.env('FROM_EMAIL').split('@')[1]}>`, headers: marketing ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}, disableFileAccess: true, disableUrlAccess: true });
      accepted = info.accepted.length > 0;
      // SES answers "250 Ok <ses-id>" and reports bounces with that id; other providers keep our Message-ID.
      const providerMessageId = /^250 Ok ([\w-]+)/i.exec(info.response ?? '')?.[1] ?? stripId(info.messageId);
      await this.db.marketingMessage.update({ where: { id }, data: { status: accepted ? 'SENT' : 'FAILED', sentAt: accepted ? new Date() : null, providerMessageId: providerMessageId || null, error: accepted ? null : 'Destinatario rechazado por SMTP.' } });
    } catch (e: any) {
      // A timeout/disconnect (or a DB error after SMTP accepted) is not safe to retry.
      const definite = !accepted && (e.responseCode >= 400 || ['EAUTH', 'ECONNECTION', 'EDNS'].includes(e.code));
      await this.db.marketingMessage.updateMany({ where: { id, status: 'SENDING' }, data: { status: definite ? 'FAILED' : 'UNKNOWN', error: definite ? `SMTP rechazó el envío (${e.code || e.responseCode}${e.response ? `: ${String(e.response).slice(0, 300)}` : ''}).` : 'No se puede confirmar si SMTP aceptó el mensaje. Revisar antes de reenviar.' } });
    }
  }
}

/** Maps a Klaviyo profile (API revision 2024-10-15, with subscriptions) to a contact, keeping its consent and suppressions. */
export function klaviyoContact(profile: any): ContactInput | null {
  const a = profile?.attributes ?? {};
  let email: string;
  try { email = d.email(a.email); } catch { return null; }
  const m = a.subscriptions?.email?.marketing ?? {};
  const reasons: string[] = Array.isArray(m.suppression) ? m.suppression.map((s: any) => String(s?.reason ?? '')) : [];
  const status = reasons.includes('SPAM_COMPLAINT') ? 'COMPLAINED'
    : reasons.some(r => ['HARD_BOUNCE', 'INVALID_EMAIL'].includes(r)) ? 'BOUNCED'
    : m.consent === 'SUBSCRIBED' && m.can_receive_email_marketing !== false ? 'SUBSCRIBED'
    : m.consent === 'UNSUBSCRIBED' || reasons.length ? 'UNSUBSCRIBED' : 'PENDING';
  const consentAt = m.consent_timestamp ? new Date(m.consent_timestamp) : null;
  return {
    email, firstName: String(a.first_name ?? '').slice(0, 100), lastName: String(a.last_name ?? '').slice(0, 100), country: String(a.location?.country ?? '').slice(0, 100), tags: ['klaviyo'], status,
    consentAt: consentAt && Number.isFinite(consentAt.getTime()) ? consentAt : null, consentSource: `klaviyo:${String(m.method ?? 'import').slice(0, 60)}`
  };
}
