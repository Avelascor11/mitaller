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
      this.prisma.collaboration.findMany({ select: { status: true } }),
      this.prisma.ugcSubmission.findMany({ select: { status: true } })
    ]);

    return {
      influencers: influencers.length,
      activeCollaborations: collaborations.filter((item) => !['CLOSED', 'CANCELLED'].includes(item.status)).length,
      awaitingContent: collaborations.filter((item) => item.status === 'AWAITING_CONTENT').length,
      pendingSubmissions: submissions.filter((item) => item.status === 'PENDING').length,
      byStage: this.countBy(influencers.map((item) => item.stage)),
      byCollaborationStatus: this.countBy(collaborations.map((item) => item.status)),
      bySubmissionStatus: this.countBy(submissions.map((item) => item.status))
    };
  }

  list(input: { stage?: string; q?: string }) {
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

    return this.prisma.influencer.findMany({
      where,
      include: {
        collaborations: { orderBy: { updatedAt: 'desc' } },
        submissions: { orderBy: { createdAt: 'desc' }, take: 8 }
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });
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
      suggestedAction: this.clean(input.suggestedAction)
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

  private handle(value?: string) {
    return value?.trim().replace(/^@+/, '').toLowerCase() ?? '';
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
