import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollabStatus, CollabType, InfluencerStage, Prisma, UgcStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCollaborationBody,
  CreateInfluencerBody,
  CreateSubmissionBody,
  UpdateCollaborationBody,
  UpdateInfluencerBody,
  UpdateSubmissionBody,
  UploadSubmissionBody
} from './influencers.controller';

@Injectable()
export class InfluencersService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async summary() {
    const [influencers, collaborations, submissions] = await Promise.all([
      this.prisma.influencer.findMany({ select: { stage: true } }),
      this.prisma.collaboration.findMany({
        select: {
          id: true,
          status: true,
          title: true,
          productSent: true,
          discountCode: true,
          requestedCode: true,
          shopifyOrderId: true,
          shopifyOrderName: true,
          notes: true,
          influencer: { select: { igHandle: true, fullName: true, email: true } }
        }
      }),
      this.prisma.ugcSubmission.findMany({ select: { status: true } })
    ]);
    const fulfillment = await this.fulfillmentByCollaboration(collaborations);
    const fulfillmentValues = [...fulfillment.values()];

    return {
      influencers: influencers.length,
      activeCollaborations: collaborations.filter((item) => !['CLOSED', 'CANCELLED'].includes(item.status)).length,
      awaitingContent: collaborations.filter((item) => item.status === 'AWAITING_CONTENT').length,
      pendingSubmissions: submissions.filter((item) => item.status === 'PENDING').length,
      packsShipped: fulfillmentValues.filter((item) => ['IN_TRANSIT', 'DELIVERED'].includes(item.status)).length,
      packsDelivered: fulfillmentValues.filter((item) => item.status === 'DELIVERED').length,
      byStage: this.countBy(influencers.map((item) => item.stage)),
      byCollaborationStatus: this.countBy(collaborations.map((item) => item.status)),
      bySubmissionStatus: this.countBy(submissions.map((item) => item.status))
    };
  }

  async list(input: { stage?: string; q?: string }) {
    const where: Prisma.InfluencerWhereInput = {};
    if (input.stage) where.stage = this.enumValue(InfluencerStage, input.stage, 'stage');
    if (input.q?.trim()) {
      const q = input.q.trim();
      where.OR = [
        { igHandle: { contains: q, mode: 'insensitive' } },
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { detectionReason: { contains: q, mode: 'insensitive' } },
        { lastMessage: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } }
      ];
    }

    const influencers = await this.prisma.influencer.findMany({
      where,
      include: {
        collaborations: { orderBy: { updatedAt: 'desc' } },
        submissions: { orderBy: { createdAt: 'desc' }, take: 8 }
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });
    const collaborations = influencers.flatMap((influencer) =>
      influencer.collaborations.map((collaboration) => ({
        ...collaboration,
        influencer: {
          igHandle: influencer.igHandle,
          fullName: influencer.fullName,
          email: influencer.email
        }
      }))
    );
    const fulfillment = await this.fulfillmentByCollaboration(collaborations);
    return influencers.map((influencer) => ({
      ...influencer,
      collaborations: influencer.collaborations.map((collaboration) => ({
        ...collaboration,
        fulfillment: fulfillment.get(collaboration.id) ?? this.emptyFulfillment(collaboration)
      }))
    }));
  }

  createInfluencer(input: CreateInfluencerBody) {
    const igHandle = this.handle(input.igHandle);
    if (!igHandle) throw new BadRequestException('igHandle requerido');
    return this.prisma.influencer.upsert({
      where: { igHandle },
      update: this.influencerUpdateData(input),
      create: {
        igHandle,
        ...this.influencerCreateData(input)
      },
      include: { collaborations: true, submissions: true }
    });
  }

  async updateInfluencer(id: string, input: UpdateInfluencerBody) {
    await this.ensureInfluencer(id);
    return this.prisma.influencer.update({
      where: { id },
      data: this.influencerUpdateData(input),
      include: { collaborations: true, submissions: true }
    });
  }

  async deleteInfluencer(id: string) {
    await this.ensureInfluencer(id);
    await this.prisma.influencer.delete({ where: { id } });
    return { ok: true, id };
  }

  async createCollaboration(influencerId: string, input: CreateCollaborationBody) {
    await this.ensureInfluencer(influencerId);
    if (!input.title?.trim()) throw new BadRequestException('title requerido');
    return this.prisma.collaboration.create({
      data: {
        influencerId,
        title: input.title.trim(),
        status: input.status ? this.enumValue(CollabStatus, input.status, 'status') : undefined,
        type: input.type ? this.enumValue(CollabType, input.type, 'type') : undefined,
        compensation: this.optionalNumber(input.compensation),
        productSent: this.clean(input.productSent),
        deliverables: this.clean(input.deliverables),
        discountCode: this.clean(input.discountCode),
        metaCampaignId: this.clean(input.metaCampaignId),
        deadline: this.optionalDate(input.deadline),
        notes: this.clean(input.notes)
      },
      include: { influencer: true, submissions: true }
    });
  }

  async updateCollaboration(id: string, input: UpdateCollaborationBody) {
    const existing = await this.prisma.collaboration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Colaboracion no encontrada');
    return this.prisma.collaboration.update({
      where: { id },
      data: {
        title: input.title?.trim(),
        status: input.status ? this.enumValue(CollabStatus, input.status, 'status') : undefined,
        type: input.type ? this.enumValue(CollabType, input.type, 'type') : undefined,
        compensation: this.optionalNumber(input.compensation),
        productSent: this.clean(input.productSent),
        deliverables: this.clean(input.deliverables),
        discountCode: this.clean(input.discountCode),
        metaCampaignId: this.clean(input.metaCampaignId),
        deadline: this.optionalDate(input.deadline),
        closedAt: this.optionalDate(input.closedAt),
        notes: this.clean(input.notes)
      },
      include: { influencer: true, submissions: true }
    });
  }

  async markCollaborationReceived(id: string) {
    const existing = await this.prisma.collaboration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Colaboracion no encontrada');
    return this.prisma.collaboration.update({
      where: { id },
      data: {
        status: 'AWAITING_CONTENT',
        notes: this.appendNote(existing.notes, `Producto recibido por la influ el ${this.todayLabel()}. Recordar contenido.`)
      },
      include: { influencer: true, submissions: true }
    });
  }

  async markCollaborationContentReceived(id: string) {
    const existing = await this.prisma.collaboration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Colaboracion no encontrada');
    return this.prisma.collaboration.update({
      where: { id },
      data: {
        status: 'CONTENT_RECEIVED',
        notes: this.appendNote(existing.notes, `Contenido recibido el ${this.todayLabel()}.`)
      },
      include: { influencer: true, submissions: true }
    });
  }

  async createSubmission(influencerId: string, input: CreateSubmissionBody) {
    await this.ensureInfluencer(influencerId);
    return this.prisma.ugcSubmission.create({
      data: {
        influencerId,
        collaborationId: this.clean(input.collaborationId),
        videoUrl: this.clean(input.videoUrl),
        thumbnailUrl: this.clean(input.thumbnailUrl),
        originalFilename: this.clean(input.originalFilename),
        mimeType: this.clean(input.mimeType),
        fileSizeBytes: this.optionalNumber(input.fileSizeBytes),
        storageProvider: this.clean(input.storageProvider),
        storageKey: this.clean(input.storageKey),
        source: this.clean(input.source),
        usageRights: this.clean(input.usageRights),
        caption: this.clean(input.caption),
        type: this.clean(input.type) ?? 'UGC',
        status: input.status ? this.enumValue(UgcStatus, input.status, 'status') : undefined,
        metaCampaignId: this.clean(input.metaCampaignId),
        receivedAt: this.optionalDate(input.receivedAt) ?? new Date(),
        approvedForAdsAt: this.optionalDate(input.approvedForAdsAt),
        notes: this.clean(input.notes)
      },
      include: { influencer: true, collaboration: true }
    });
  }

  async uploadSubmission(influencerId: string, input: UploadSubmissionBody) {
    await this.ensureInfluencer(influencerId);
    if (!input.filename?.trim()) throw new BadRequestException('filename requerido');
    if (!input.mimeType?.startsWith('video/')) throw new BadRequestException('Solo se aceptan videos');
    if (!input.videoBase64?.trim()) throw new BadRequestException('videoBase64 requerido');

    const buffer = Buffer.from(input.videoBase64, 'base64');
    if (!buffer.length) throw new BadRequestException('videoBase64 vacio');
    if (buffer.length > this.maxUploadBytes()) {
      throw new BadRequestException(`Video demasiado grande. Maximo ${Math.round(this.maxUploadBytes() / 1024 / 1024)} MB`);
    }

    const storageDir = this.ugcStorageDir();
    const dateFolder = new Date().toISOString().slice(0, 10);
    const safeFilename = this.safeFilename(input.filename);
    const storageKey = `${dateFolder}/${randomUUID()}-${safeFilename}`;
    await mkdir(join(storageDir, dateFolder), { recursive: true });
    await writeFile(join(storageDir, ...storageKey.split('/')), buffer);

    const created = await this.prisma.ugcSubmission.create({
      data: {
        influencerId,
        collaborationId: this.clean(input.collaborationId),
        videoUrl: 'pending',
        thumbnailUrl: this.clean(input.thumbnailUrl),
        originalFilename: safeFilename,
        mimeType: input.mimeType.trim(),
        fileSizeBytes: buffer.length,
        storageProvider: this.storageProvider(),
        storageKey,
        source: this.clean(input.source) ?? 'manual_upload',
        usageRights: this.clean(input.usageRights),
        caption: this.clean(input.caption),
        type: this.clean(input.type) ?? 'UGC',
        status: input.status ? this.enumValue(UgcStatus, input.status, 'status') : undefined,
        metaCampaignId: this.clean(input.metaCampaignId),
        receivedAt: this.optionalDate(input.receivedAt) ?? new Date(),
        approvedForAdsAt: this.optionalDate(input.approvedForAdsAt),
        notes: this.clean(input.notes)
      },
      include: { influencer: true, collaboration: true }
    });

    return this.prisma.ugcSubmission.update({
      where: { id: created.id },
      data: { videoUrl: this.submissionVideoUrl(created.id) },
      include: { influencer: true, collaboration: true }
    });
  }

  async getSubmissionVideo(id: string) {
    const submission = await this.prisma.ugcSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('UGC no encontrado');
    if (!submission.storageKey) throw new BadRequestException('Este UGC no tiene archivo guardado');
    if (submission.storageProvider && submission.storageProvider !== this.storageProvider()) {
      throw new BadRequestException(`Storage no soportado por este servidor: ${submission.storageProvider}`);
    }

    const filePath = join(this.ugcStorageDir(), ...submission.storageKey.split('/'));
    const info = await stat(filePath).catch(() => null);
    if (!info) throw new NotFoundException('Archivo UGC no encontrado en storage');
    return {
      stream: createReadStream(filePath),
      mimeType: submission.mimeType ?? 'video/mp4',
      filename: submission.originalFilename ?? `${submission.id}${extname(filePath) || '.mp4'}`,
      size: info.size
    };
  }

  async updateSubmission(id: string, input: UpdateSubmissionBody) {
    const existing = await this.prisma.ugcSubmission.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('UGC no encontrado');
    return this.prisma.ugcSubmission.update({
      where: { id },
      data: {
        collaborationId: this.clean(input.collaborationId),
        videoUrl: this.clean(input.videoUrl),
        thumbnailUrl: this.clean(input.thumbnailUrl),
        originalFilename: this.clean(input.originalFilename),
        mimeType: this.clean(input.mimeType),
        fileSizeBytes: this.optionalNumber(input.fileSizeBytes),
        storageProvider: this.clean(input.storageProvider),
        storageKey: this.clean(input.storageKey),
        source: this.clean(input.source),
        usageRights: this.clean(input.usageRights),
        caption: this.clean(input.caption),
        type: this.clean(input.type),
        status: input.status ? this.enumValue(UgcStatus, input.status, 'status') : undefined,
        metaCampaignId: this.clean(input.metaCampaignId),
        receivedAt: this.optionalDate(input.receivedAt),
        approvedForAdsAt: this.optionalDate(input.approvedForAdsAt),
        notes: this.clean(input.notes)
      },
      include: { influencer: true, collaboration: true }
    });
  }

  private influencerCreateData(input: CreateInfluencerBody): Omit<Prisma.InfluencerUncheckedCreateInput, 'igHandle'> {
    return {
      fullName: this.clean(input.fullName),
      manychatId: this.clean(input.manychatId),
      followers: this.optionalNumber(input.followers),
      email: this.clean(input.email),
      stage: input.stage ? this.enumValue(InfluencerStage, input.stage, 'stage') : undefined,
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
      notes: this.clean(input.notes),
      source: this.clean(input.source),
      detectionScore: this.optionalNumber(input.detectionScore) ?? 0,
      detectionReason: this.clean(input.detectionReason),
      suggestedAction: this.clean(input.suggestedAction),
      lastMessage: this.clean(input.lastMessage),
      lastMessageAt: this.optionalDate(input.lastMessageAt),
      firstDetectedAt: this.optionalDate(input.firstDetectedAt) ?? (input.source ? new Date() : undefined),
      lastInboundAt: this.optionalDate(input.lastInboundAt)
    };
  }

  private influencerUpdateData(input: UpdateInfluencerBody): Prisma.InfluencerUncheckedUpdateInput {
    const data: Prisma.InfluencerUncheckedUpdateInput = {
      fullName: this.clean(input.fullName),
      manychatId: this.clean(input.manychatId),
      followers: this.optionalNumber(input.followers),
      email: this.clean(input.email),
      stage: input.stage ? this.enumValue(InfluencerStage, input.stage, 'stage') : undefined,
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean),
      notes: this.clean(input.notes),
      source: this.clean(input.source),
      detectionScore: this.optionalNumber(input.detectionScore),
      detectionReason: this.clean(input.detectionReason),
      suggestedAction: this.clean(input.suggestedAction)
    };
    if ('lastMessage' in input) data.lastMessage = this.clean(input.lastMessage);
    if ('lastMessageAt' in input) data.lastMessageAt = this.optionalDate(input.lastMessageAt);
    if ('firstDetectedAt' in input) data.firstDetectedAt = this.optionalDate(input.firstDetectedAt);
    if ('lastInboundAt' in input) data.lastInboundAt = this.optionalDate(input.lastInboundAt);
    return data;
  }

  private async ensureInfluencer(id: string) {
    const influencer = await this.prisma.influencer.findUnique({ where: { id } });
    if (!influencer) throw new NotFoundException('Influencer no encontrado');
    return influencer;
  }

  private async fulfillmentByCollaboration(collaborations: CollaborationLookup[]) {
    const references = collaborations
      .flatMap((collaboration) => this.orderReferencesFor(collaboration))
      .filter((value): value is string => Boolean(value?.trim()));
    const emails = [...new Set(collaborations.map((collaboration) => collaboration.influencer?.email).filter((value): value is string => Boolean(value?.trim())).map((value) => value.toLowerCase()))];
    const names = [...new Set(collaborations.map((collaboration) => collaboration.influencer?.fullName).filter((value): value is string => Boolean(value?.trim() && value.trim().length >= 4)))];
    const handles = [...new Set(collaborations.map((collaboration) => collaboration.influencer?.igHandle).filter((value): value is string => Boolean(value?.trim() && value.trim().length >= 3)))];
    if (!references.length && !emails.length && !names.length && !handles.length) {
      return new Map<string, CollaborationFulfillment>();
    }

    const orderWhere: Prisma.OrderWhereInput[] = [];
    if (references.length) {
      orderWhere.push(
        { id: { in: references } },
        { shopifyOrderId: { in: references } },
        { orderNumber: { in: references } }
      );
    }
    if (emails.length) orderWhere.push({ customerEmail: { in: emails, mode: 'insensitive' } });
    for (const name of names) orderWhere.push({ customerName: { contains: name.trim(), mode: 'insensitive' } });
    for (const handle of handles) orderWhere.push({ customerName: { contains: handle.trim().replace(/^@/, ''), mode: 'insensitive' } });

    const orders = await this.prisma.order.findMany({
      where: {
        OR: orderWhere
      },
      include: { shipments: { orderBy: { updatedAt: 'desc' } } }
    });
    const byReference = new Map<string, (typeof orders)[number]>();
    for (const order of orders) {
      byReference.set(order.id, order);
      byReference.set(order.shopifyOrderId, order);
      byReference.set(order.orderNumber, order);
      byReference.set(order.orderNumber.replace(/^#/, ''), order);
    }

    return new Map(collaborations.map((collaboration) => {
      const explicitOrder = this.orderReferencesFor(collaboration)
        .map((value) => byReference.get(value))
        .find(Boolean);
      const detectedOrder = explicitOrder ?? this.detectOrderForCollaboration(collaboration, orders);
      const matchSource = explicitOrder ? 'reference' : detectedOrder ? this.detectOrderMatchSource(collaboration, detectedOrder) : null;
      return [collaboration.id, detectedOrder ? this.fulfillmentFromOrder(detectedOrder, matchSource) : this.emptyFulfillment(collaboration)] as const;
    }));
  }

  private fulfillmentFromOrder(order: Prisma.OrderGetPayload<{ include: { shipments: true } }>, matchSource: string | null): CollaborationFulfillment {
    const shipment = order.shipments[0];
    const status = this.collaborationFulfillmentStatus(order.operationalStatus, shipment?.status, shipment?.trackingStatus);
    return {
      status,
      label: this.collaborationFulfillmentLabel(status),
      orderId: order.id,
      orderNumber: order.orderNumber,
      operationalStatus: order.operationalStatus,
      shipmentStatus: shipment?.status ?? null,
      trackingStatus: shipment?.trackingStatus ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
      trackingUrl: shipment?.trackingUrl ?? null,
      carrier: shipment?.carrier ?? null,
      updatedAt: shipment?.trackingSyncedAt ?? shipment?.updatedAt ?? order.updatedAt,
      matchSource
    };
  }

  private emptyFulfillment(collaboration: { shopifyOrderId?: string | null; shopifyOrderName?: string | null }): CollaborationFulfillment {
    const hasReference = Boolean(collaboration.shopifyOrderId?.trim() || collaboration.shopifyOrderName?.trim());
    return {
      status: hasReference ? 'ORDER_NOT_FOUND' : 'NO_ORDER',
      label: hasReference ? 'Pedido no encontrado' : 'Sin pedido asociado',
      orderId: null,
      orderNumber: collaboration.shopifyOrderName ?? null,
      operationalStatus: null,
      shipmentStatus: null,
      trackingStatus: null,
      trackingNumber: null,
      trackingUrl: null,
      carrier: null,
      updatedAt: null,
      matchSource: null
    };
  }

  private collaborationFulfillmentStatus(operationalStatus: string, shipmentStatus?: string | null, trackingStatus?: string | null) {
    const tracking = this.normalizeText(trackingStatus ?? '');
    if (shipmentStatus === 'DELIVERED' || tracking.includes('delivered') || tracking.includes('entregado')) return 'DELIVERED';
    if (shipmentStatus === 'IN_TRANSIT' || operationalStatus === 'SHIPPED') return 'IN_TRANSIT';
    if (shipmentStatus === 'LABEL_CREATED' || shipmentStatus === 'PRINTED') return 'LABEL_CREATED';
    if (shipmentStatus === 'PARCEL_CREATED') return 'PARCEL_CREATED';
    if (['READY_FOR_LABEL', 'LABEL_CREATED'].includes(operationalStatus)) return 'READY_TO_SHIP';
    if (['NEW', 'WAITING_STOCK', 'WAITING_PRODUCTION', 'IN_PRODUCTION', 'PRODUCED', 'WAITING_PICKING', 'PICKED'].includes(operationalStatus)) return 'PREPARING';
    return 'UNKNOWN';
  }

  private collaborationFulfillmentLabel(status: string) {
    const labels: Record<string, string> = {
      NO_ORDER: 'Sin pedido asociado',
      ORDER_NOT_FOUND: 'Pedido no encontrado',
      PREPARING: 'Preparando pack',
      READY_TO_SHIP: 'Listo para enviar',
      PARCEL_CREATED: 'Paquete creado',
      LABEL_CREATED: 'Etiqueta creada',
      IN_TRANSIT: 'En camino',
      DELIVERED: 'Entregado',
      UNKNOWN: 'Estado desconocido'
    };
    return labels[status] ?? status;
  }

  private cleanOrderReference(value?: string | null) {
    const clean = value?.trim();
    if (!clean) return null;
    return clean.startsWith('#') ? clean : `#${clean}`;
  }

  private orderReferencesFor(collaboration: CollaborationLookup) {
    const textReferences = [
      collaboration.shopifyOrderId,
      collaboration.shopifyOrderName,
      this.cleanOrderReference(collaboration.shopifyOrderName),
      ...this.extractOrderReferences([
        collaboration.title,
        collaboration.productSent,
        collaboration.notes,
        collaboration.discountCode,
        collaboration.requestedCode
      ].filter(Boolean).join(' '))
    ];
    return [...new Set(textReferences.filter((value): value is string => Boolean(value?.trim())))];
  }

  private extractOrderReferences(value: string) {
    const references = new Set<string>();
    const matches = value.match(/#?\b\d{4,7}\b/g) ?? [];
    for (const match of matches) {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 4) {
        references.add(`#${digits}`);
        references.add(digits);
      }
    }
    return [...references];
  }

  private detectOrderForCollaboration(
    collaboration: CollaborationLookup,
    orders: Array<Prisma.OrderGetPayload<{ include: { shipments: true } }>>
  ) {
    const email = collaboration.influencer?.email?.trim().toLowerCase();
    const name = this.normalizeText(collaboration.influencer?.fullName ?? '');
    const handle = this.normalizeText(collaboration.influencer?.igHandle ?? '').replace(/^@/, '');
    const candidates = orders.filter((order) => {
      const orderEmail = order.customerEmail?.trim().toLowerCase();
      const orderName = this.normalizeText(order.customerName ?? '');
      if (email && orderEmail === email) return true;
      if (name && name.length >= 4 && orderName.includes(name)) return true;
      if (handle && handle.length >= 3 && orderName.includes(handle)) return true;
      return false;
    });
    return candidates.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
  }

  private detectOrderMatchSource(
    collaboration: CollaborationLookup,
    order: Prisma.OrderGetPayload<{ include: { shipments: true } }>
  ) {
    const email = collaboration.influencer?.email?.trim().toLowerCase();
    if (email && order.customerEmail?.trim().toLowerCase() === email) return 'email';
    const name = this.normalizeText(collaboration.influencer?.fullName ?? '');
    if (name && this.normalizeText(order.customerName ?? '').includes(name)) return 'name';
    const handle = this.normalizeText(collaboration.influencer?.igHandle ?? '').replace(/^@/, '');
    if (handle && this.normalizeText(order.customerName ?? '').includes(handle)) return 'handle';
    return 'detected';
  }

  private handle(value?: string) {
    const raw = value?.trim();
    if (!raw) return '';
    const urlMatch = raw.match(/instagram\.com\/(?:reel\/|p\/|stories\/)?@?([a-zA-Z0-9._]+)/i);
    const atMatch = raw.match(/@([a-zA-Z0-9._]+)/);
    const fallback = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').split(/[/?#\s]/)[0];
    return (urlMatch?.[1] ?? atMatch?.[1] ?? fallback)
      .replace(/^@+/, '')
      .replace(/[^a-zA-Z0-9._]/g, '')
      .toLowerCase();
  }

  private clean(value?: string | null) {
    const cleaned = value?.trim();
    return cleaned ? cleaned : undefined;
  }

  private optionalNumber(value?: number | null) {
    if (value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private optionalDate(value?: string | null) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Fecha invalida');
    return date;
  }

  private ugcStorageDir() {
    return this.config.get<string>('UGC_STORAGE_DIR') ?? join(process.cwd(), 'storage', 'ugc');
  }

  private storageProvider() {
    return this.config.get<string>('UGC_STORAGE_PROVIDER') ?? 'local';
  }

  private publicApiUrl() {
    return (this.config.get<string>('PUBLIC_API_URL') ?? '').replace(/\/+$/, '');
  }

  private submissionVideoUrl(id: string) {
    const path = `/influencers/submissions/${id}/video`;
    return this.publicApiUrl() ? `${this.publicApiUrl()}${path}` : path;
  }

  private maxUploadBytes() {
    const mb = Number(this.config.get<string>('UGC_MAX_UPLOAD_MB') ?? 250);
    return Math.max(1, Number.isFinite(mb) ? mb : 250) * 1024 * 1024;
  }

  private safeFilename(value: string) {
    const cleaned = value.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ');
    return cleaned.slice(0, 160) || 'ugc-video.mp4';
  }

  private normalizeText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private appendNote(existing: string | null | undefined, note: string) {
    return [existing?.trim(), note].filter(Boolean).join('\n');
  }

  private todayLabel() {
    return new Date().toISOString().slice(0, 10);
  }

  private enumValue<T extends Record<string, string>>(source: T, value: string, field: string): T[keyof T] {
    const normalized = value.trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(source, normalized)) {
      throw new BadRequestException(`${field} invalido: ${value}`);
    }
    return source[normalized as keyof T];
  }

  private countBy(values: string[]) {
    return values.reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
  }
}

interface CollaborationLookup {
  id: string;
  title?: string | null;
  productSent?: string | null;
  discountCode?: string | null;
  requestedCode?: string | null;
  shopifyOrderId?: string | null;
  shopifyOrderName?: string | null;
  notes?: string | null;
  influencer?: {
    igHandle?: string | null;
    fullName?: string | null;
    email?: string | null;
  } | null;
}

interface CollaborationFulfillment {
  status: string;
  label: string;
  orderId: string | null;
  orderNumber: string | null;
  operationalStatus: string | null;
  shipmentStatus: string | null;
  trackingStatus: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  updatedAt: Date | null;
  matchSource: string | null;
}
