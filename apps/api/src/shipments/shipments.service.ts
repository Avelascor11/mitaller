import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
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

  async confirmLabelScan(orderId: string, barcode?: string) {
    const cleanBarcode = barcode?.trim();
    if (!cleanBarcode) {
      throw new BadRequestException('Escanea o introduce el numero de barras de la etiqueta.');
    }

    const order = await this.prisma.order.findFirstOrThrow({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: { shipments: { orderBy: { createdAt: 'desc' } } }
    });
    const existingShipment = order.shipments[0];
    const shipment = existingShipment
      ? await this.prisma.shipment.update({
        where: { id: existingShipment.id },
        data: {
          trackingNumber: cleanBarcode,
          status: 'LABEL_CREATED'
        }
      })
      : await this.prisma.shipment.create({
        data: {
          orderId: order.id,
          provider: 'SENDCLOUD',
          trackingNumber: cleanBarcode,
          status: 'LABEL_CREATED'
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

  private assertPrintAgentToken(token?: string) {
    const configured = this.config.get<string>('PRINT_AGENT_TOKEN')?.trim();
    if (!configured) return;
    if (token !== configured) throw new UnauthorizedException('Print agent token invalido');
  }
}
