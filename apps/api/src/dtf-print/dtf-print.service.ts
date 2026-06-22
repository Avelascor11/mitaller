import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DtfPrintJobStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseService } from '../purchasing/purchase.service';

type PurchaseMatrixEntry = {
  size: string;
  subproductName: string;
  sku?: string | null;
  stockItemId?: string | null;
  pendingOrderNeed: number;
  currentInternalStock: number;
  recommendedPurchaseQuantity: number;
  imageRef?: string | null;
  demandOrders?: Array<{
    orderId: string;
    orderNumber: string;
    customerName?: string;
    orderItemId: string;
    title: string;
    sku?: string | null;
    quantity: number;
  }>;
};

const ACTIVE_STATUSES: DtfPrintJobStatus[] = [DtfPrintJobStatus.PENDING, DtfPrintJobStatus.PROCESSING];

@Injectable()
export class DtfPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchase: PurchaseService,
    private readonly config: ConfigService,
    private readonly activity: ActivityService
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoGenerate() {
    const enabled = String(this.config.get<string>('DTF_AUTO_PRINT_ENABLED') ?? 'false').toLowerCase() === 'true';
    if (!enabled) return;
    await this.generateMissingDtfPrintJobs();
  }

  async listJobs() {
    return this.prisma.dtfPrintJob.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 80
    });
  }

  async generateMissingDtfPrintJobs() {
    const matrix = await this.purchase.getPurchaseMatrix();
    const dtfGroup = matrix.groups.find((group) => group.garmentType === 'DTF');
    const entries = (dtfGroup?.sizes ?? []) as PurchaseMatrixEntry[];
    const printableEntries = entries.filter((entry) => entry.recommendedPurchaseQuantity > 0);
    const activeJobs = await this.prisma.dtfPrintJob.findMany({
      where: { status: { in: ACTIVE_STATUSES } }
    });
    const activeBySku = new Map<string, number>();
    for (const job of activeJobs) {
      activeBySku.set(job.sku, (activeBySku.get(job.sku) ?? 0) + job.quantity);
    }

    const created = [];
    const skipped = [];
    for (const entry of printableEntries) {
      const sku = entry.sku ?? `DTF-${entry.size}`;
      const queuedQuantity = activeBySku.get(sku) ?? 0;
      const missingQuantity = Math.max(0, entry.recommendedPurchaseQuantity - queuedQuantity);
      if (missingQuantity === 0) {
        skipped.push({ sku, reason: 'already_queued', queuedQuantity });
        continue;
      }
      if (!entry.imageRef) {
        skipped.push({ sku, reason: 'missing_image' });
        continue;
      }

      const orderNumbers = [...new Set((entry.demandOrders ?? []).map((order) => order.orderNumber).filter(Boolean))];
      const dedupeKey = this.dedupeKey(sku, missingQuantity, entry.demandOrders ?? []);
      const job = await this.prisma.dtfPrintJob.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          sku,
          stockItemId: entry.stockItemId ?? null,
          designName: entry.subproductName.replace(/^DTF\s+/i, ''),
          imageUrl: entry.imageRef,
          quantity: missingQuantity,
          orderNumbers,
          metadataJson: {
            pendingOrderNeed: entry.pendingOrderNeed,
            currentInternalStock: entry.currentInternalStock,
            recommendedPurchaseQuantity: entry.recommendedPurchaseQuantity,
            queuedQuantity,
            demandOrders: entry.demandOrders ?? []
          }
        }
      });
      activeBySku.set(sku, queuedQuantity + missingQuantity);
      created.push(job);
    }

    if (created.length) {
      await this.activity.log({
        entityType: 'DtfPrintJob',
        entityId: 'bulk',
        action: 'DTF_PRINT_JOBS_GENERATED',
        message: `Creados ${created.length} trabajos de impresion DTF`,
        metadataJson: { created: created.map((job) => ({ id: job.id, sku: job.sku, quantity: job.quantity })), skipped }
      });
    }

    return { created, skipped, pending: printableEntries.length };
  }

  async claimQueue(token?: string) {
    this.assertAgentToken(token);
    const jobs = await this.prisma.dtfPrintJob.findMany({
      where: { status: DtfPrintJobStatus.PENDING, imageUrl: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: Number(this.config.get<string>('DTF_PRINT_QUEUE_BATCH_SIZE') ?? 3)
    });

    const claimed = [];
    for (const job of jobs) {
      const owned = await this.prisma.dtfPrintJob.updateMany({
        where: { id: job.id, status: DtfPrintJobStatus.PENDING },
        data: { status: DtfPrintJobStatus.PROCESSING, lockedAt: new Date(), errorMessage: null }
      });
      if (!owned.count) continue;
      claimed.push({
        id: job.id,
        sku: job.sku,
        designName: job.designName,
        imageUrl: job.imageUrl,
        quantity: job.quantity,
        orderNumbers: job.orderNumbers,
        createdAt: job.createdAt
      });
    }
    return claimed;
  }

  async markPrinted(id: string, token?: string, result?: unknown) {
    this.assertAgentToken(token);
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.dtfPrintJob.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Trabajo DTF no encontrado');
      if (job.status === DtfPrintJobStatus.PRINTED) return job;

      const stockItem = await tx.stockItem.upsert({
        where: { sku: job.sku },
        update: { type: 'TRANSFER', name: `DTF ${job.designName}`, supplierSku: job.sku },
        create: { sku: job.sku, name: `DTF ${job.designName}`, type: 'TRANSFER', supplierSku: job.sku, minStock: 0 }
      });
      const location = await tx.stockLocation.upsert({
        where: { code: 'TALLER' },
        update: {},
        create: { code: 'TALLER', name: 'Taller', type: 'WORKSHOP' }
      });
      await tx.stockLevel.upsert({
        where: { stockItemId_locationId: { stockItemId: stockItem.id, locationId: location.id } },
        create: { stockItemId: stockItem.id, locationId: location.id, quantity: job.quantity },
        update: { quantity: { increment: job.quantity } }
      });
      await tx.stockMovement.create({
        data: {
          stockItemId: stockItem.id,
          toLocationId: location.id,
          quantity: job.quantity,
          reason: 'DTF_IMPRESO_AUTOMATICO'
        }
      });
      await tx.activityLog.create({
        data: {
          entityType: 'DtfPrintJob',
          entityId: job.id,
          action: 'DTF_PRINTED',
          message: `${job.quantity} DTF impresos: ${job.designName}`,
          metadataJson: { sku: job.sku, orderNumbers: job.orderNumbers, result: result as object | undefined }
        }
      });
      return tx.dtfPrintJob.update({
        where: { id },
        data: {
          status: DtfPrintJobStatus.PRINTED,
          printedAt: new Date(),
          failedAt: null,
          errorMessage: null,
          printResult: result as object | undefined,
          stockItemId: stockItem.id
        }
      });
    });
  }

  async markFailed(id: string, token?: string, errorMessage = 'Fallo de impresion DTF', result?: unknown) {
    this.assertAgentToken(token);
    const job = await this.prisma.dtfPrintJob.update({
      where: { id },
      data: {
        status: DtfPrintJobStatus.FAILED,
        failedAt: new Date(),
        errorMessage: errorMessage.slice(0, 1000),
        printResult: result as object | undefined
      }
    });
    await this.activity.log({
      entityType: 'DtfPrintJob',
      entityId: job.id,
      action: 'DTF_PRINT_FAILED',
      message: `Fallo imprimiendo DTF ${job.designName}: ${job.errorMessage}`,
      metadataJson: { sku: job.sku, result: result as object | undefined }
    });
    return job;
  }

  private dedupeKey(sku: string, quantity: number, orders: PurchaseMatrixEntry['demandOrders']) {
    const payload = JSON.stringify({
      sku,
      quantity,
      orders: (orders ?? []).map((order) => `${order.orderItemId}:${order.quantity}`).sort()
    });
    return `${sku}:${createHash('sha1').update(payload).digest('hex').slice(0, 16)}`;
  }

  private assertAgentToken(token?: string) {
    const configured = this.config.get<string>('PRINT_AGENT_TOKEN')?.trim();
    if (!configured) return;
    if (token !== configured) throw new UnauthorizedException('Print agent token invalido');
  }
}
