import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { SendcloudAdapter } from '../sendcloud/sendcloud.adapter';
import { LabelPrinterService } from './label-printer.service';
import { ShopifyAdapter } from '../shopify/shopify.adapter';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sendcloud: SendcloudAdapter,
    private readonly activity: ActivityService,
    private readonly labelPrinter: LabelPrinterService,
    private readonly shopify: ShopifyAdapter,
    private readonly config: ConfigService
  ) {}

  findAll() {
    return this.prisma.shipment.findMany({ include: { order: true }, orderBy: { createdAt: 'desc' } });
  }

  findOne(id: string) {
    return this.prisma.shipment.findUniqueOrThrow({ where: { id }, include: { order: true } });
  }

  async listShippingMethods() {
    return this.sendcloud.listShippingMethods();
  }

  async findPrintQueue(token?: string) {
    this.assertPrintAgentToken(token);
    const printedLogs = await this.prisma.activityLog.findMany({
      where: { entityType: 'Shipment', action: 'LABEL_PRINTED' },
      select: { entityId: true },
      distinct: ['entityId']
    });
    const printedIds = printedLogs.map((log) => log.entityId);
    const shipments = await this.prisma.shipment.findMany({
      where: {
        status: 'LABEL_CREATED',
        labelUrl: { not: null },
        id: { notIn: printedIds }
      },
      include: { order: { include: { items: true } } },
      orderBy: { createdAt: 'asc' },
      take: 25
    });
    return shipments.map((shipment) => ({
      id: shipment.id,
      orderNumber: shipment.order.orderNumber,
      labelUrl: shipment.labelUrl,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      createdAt: shipment.createdAt,
      itemCount: shipment.order.items.reduce((total, item) => total + item.quantity, 0)
    }));
  }

  async markPrinted(id: string, token?: string, result?: unknown) {
    this.assertPrintAgentToken(token);
    const shipment = await this.prisma.shipment.update({
      where: { id },
      data: { status: 'PRINTED' },
      include: { order: true }
    });
    await this.activity.log({
      entityType: 'Shipment',
      entityId: shipment.id,
      action: 'LABEL_PRINTED',
      message: `Etiqueta impresa para ${shipment.order.orderNumber}`,
      metadataJson: result ?? {}
    });
    return { ok: true, shipmentId: shipment.id, orderNumber: shipment.order.orderNumber };
  }

  async createLabelForOrder(orderId: string) {
    const order = await this.prisma.order.findFirstOrThrow({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: { items: true }
    });
    const label = await this.sendcloud.createShipment(order);
    const shipment = await this.prisma.shipment.create({
      data: {
        orderId: order.id,
        provider: 'SENDCLOUD',
        sendcloudParcelId: label.parcelId,
        trackingNumber: label.trackingNumber,
        carrier: label.carrier,
        labelUrl: label.labelUrl,
        cost: label.cost ?? null,
        costCurrency: label.costCurrency ?? null,
        status: 'LABEL_CREATED'
      }
    });
    await this.prisma.order.update({ where: { id: order.id }, data: { operationalStatus: 'LABEL_CREATED' } });
    const printResult = await this.labelPrinter.printLabel(label.labelUrl, order.orderNumber);
    await this.activity.log({
      entityType: 'Shipment',
      entityId: shipment.id,
      action: 'LABEL_CREATED',
      message: `Etiqueta creada para ${order.orderNumber}`,
      metadataJson: { label, printResult }
    });
    return { ...shipment, printResult };
  }

  async confirmLabelScan(orderId: string, barcode?: string, photoBase64?: string) {
    const cleanBarcode = barcode?.trim();
    if (!cleanBarcode) {
      throw new BadRequestException('Escanea o introduce el numero de barras de la etiqueta.');
    }

    const order = await this.prisma.order.findFirstOrThrow({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: { shipments: { orderBy: { createdAt: 'desc' } } }
    });
    const existingShipment = order.shipments[0];
    const photoBytes = this.decodePhoto(photoBase64);
    const photoData = photoBytes
      ? { packagePhoto: Uint8Array.from(photoBytes), packagePhotoAt: new Date() }
      : {};
    const shipment = existingShipment
      ? await this.prisma.shipment.update({
        where: { id: existingShipment.id },
        data: {
          trackingNumber: cleanBarcode,
          status: 'LABEL_CREATED',
          ...photoData
        }
      })
      : await this.prisma.shipment.create({
        data: {
          orderId: order.id,
          provider: 'SENDCLOUD',
          trackingNumber: cleanBarcode,
          status: 'LABEL_CREATED',
          ...photoData
        }
      });

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        operationalStatus: 'LABEL_CREATED',
        fulfillmentStatus: 'fulfilled'
      }
    });

    const shopifyResult = await this.shopify.updateFulfillmentTracking(
      order.shopifyOrderId,
      cleanBarcode,
      shipment.carrier ?? 'Correos'
    );

    await this.activity.log({
      entityType: 'Shipment',
      entityId: shipment.id,
      action: 'LABEL_BARCODE_SCANNED',
      message: `Etiqueta ${cleanBarcode} leida para ${order.orderNumber}`,
      metadataJson: { barcode: cleanBarcode, shopifyResult }
    });

    return {
      ...shipment,
      trackingNumber: cleanBarcode,
      order: {
        ...order,
        operationalStatus: 'LABEL_CREATED',
        fulfillmentStatus: 'fulfilled'
      },
      shopifyResult
    };
  }

  async savePackagePhoto(orderId: string, photoBase64: string) {
    const bytes = this.decodePhoto(photoBase64);
    if (!bytes) throw new BadRequestException('Foto vacia o invalida');
    const order = await this.prisma.order.findFirstOrThrow({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: { shipments: { orderBy: { createdAt: 'desc' } } }
    });
    const existing = order.shipments[0];
    if (!existing) throw new BadRequestException('Crea/escanea una etiqueta antes de guardar la foto.');
    const bytesArray = Uint8Array.from(bytes);
    const shipment = await this.prisma.shipment.update({
      where: { id: existing.id },
      data: { packagePhoto: bytesArray, packagePhotoAt: new Date() }
    });
    return { ok: true, shipmentId: shipment.id };
  }

  async getPackagePhoto(id: string): Promise<Buffer> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      select: { packagePhoto: true }
    });
    if (!shipment?.packagePhoto) throw new NotFoundException('Sin foto');
    return Buffer.from(shipment.packagePhoto as Buffer);
  }

  async findFinalized() {
    const shipments = await this.prisma.shipment.findMany({
      where: { status: { in: ['LABEL_CREATED', 'PRINTED', 'IN_TRANSIT', 'DELIVERED'] } },
      include: { order: true },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });
    return shipments.map((shipment) => ({
      id: shipment.id,
      orderId: shipment.orderId,
      orderNumber: shipment.order.orderNumber,
      customer: shipment.order.customerName,
      shippingMethod: shipment.order.shippingMethod,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      carrier: shipment.carrier,
      status: shipment.status,
      trackingStatus: shipment.trackingStatus,
      hasPhoto: Boolean(shipment.packagePhoto),
      packagePhotoAt: shipment.packagePhotoAt,
      cost: shipment.cost,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt
    }));
  }

  async fetchTracking(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { order: true }
    });
    if (!shipment) throw new NotFoundException('Envio no encontrado');
    if (!shipment.sendcloudParcelId) {
      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        trackingUrl: shipment.trackingUrl,
        status: shipment.trackingStatus ?? shipment.status,
        carrier: shipment.carrier,
        events: [] as Array<{ status: string; message?: string; at?: string }>,
        cached: true
      };
    }
    try {
      const live = await this.sendcloud.getTracking(shipment.sendcloudParcelId);
      const events = Array.isArray((live as any).events) ? (live as any).events : (live as any).statusEvents ?? [];
      const status = (live as any).status?.message ?? (live as any).status ?? shipment.trackingStatus ?? shipment.status;
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          trackingStatus: typeof status === 'string' ? status : undefined,
          trackingUrl: (live as any).trackingUrl ?? shipment.trackingUrl,
          trackingNumber: (live as any).trackingNumber ?? shipment.trackingNumber,
          trackingSyncedAt: new Date()
        }
      });
      return {
        shipmentId: shipment.id,
        trackingNumber: (live as any).trackingNumber ?? shipment.trackingNumber,
        trackingUrl: (live as any).trackingUrl ?? shipment.trackingUrl,
        status,
        carrier: (live as any).carrier ?? shipment.carrier,
        events,
        cached: false
      };
    } catch (error) {
      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        trackingUrl: shipment.trackingUrl,
        status: shipment.trackingStatus ?? shipment.status,
        carrier: shipment.carrier,
        events: [],
        error: error instanceof Error ? error.message : String(error),
        cached: true
      };
    }
  }

  private decodePhoto(input?: string): Buffer | undefined {
    if (!input) return undefined;
    const stripped = input.replace(/^data:image\/[a-z]+;base64,/i, '');
    try {
      const buffer = Buffer.from(stripped, 'base64');
      if (buffer.length < 200) return undefined;
      return buffer;
    } catch {
      return undefined;
    }
  }

  private assertPrintAgentToken(token?: string) {
    const configured = this.config.get<string>('PRINT_AGENT_TOKEN')?.trim();
    if (!configured) return;
    if (token !== configured) throw new UnauthorizedException('Print agent token invalido');
  }
}
