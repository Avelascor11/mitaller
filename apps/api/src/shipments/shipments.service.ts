import { BadRequestException, Injectable } from '@nestjs/common';
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
    private readonly shopify: ShopifyAdapter
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
}
