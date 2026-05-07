import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService, private readonly activity: ActivityService) {}

  findAll() {
    return this.prisma.stockItem.findMany({ include: { levels: { include: { location: true } } }, orderBy: { sku: 'asc' } });
  }

  locations() {
    return this.prisma.stockLocation.findMany({ orderBy: { code: 'asc' } });
  }

  getStockBySku(sku: string) {
    return this.prisma.stockItem.findUniqueOrThrow({
      where: { sku },
      include: { levels: { include: { location: true } }, movements: { orderBy: { createdAt: 'desc' }, take: 20 } }
    });
  }

  async moveStock(input: { stockItemId: string; fromLocationId?: string; toLocationId?: string; quantity: number; reason: string; userId?: string; relatedOrderId?: string; relatedTaskId?: string }) {
    if (input.quantity <= 0) throw new BadRequestException('La cantidad debe ser positiva');
    if (!input.fromLocationId && !input.toLocationId) throw new BadRequestException('Indica origen o destino');

    return this.prisma.$transaction(async (tx) => {
      if (input.fromLocationId) {
        const fromLevel = await tx.stockLevel.upsert({
          where: { stockItemId_locationId: { stockItemId: input.stockItemId, locationId: input.fromLocationId } },
          create: { stockItemId: input.stockItemId, locationId: input.fromLocationId, quantity: 0 },
          update: {}
        });
        if (fromLevel.quantity < input.quantity) throw new BadRequestException('Stock insuficiente en origen');
        await tx.stockLevel.update({ where: { id: fromLevel.id }, data: { quantity: { decrement: input.quantity } } });
      }

      if (input.toLocationId) {
        await tx.stockLevel.upsert({
          where: { stockItemId_locationId: { stockItemId: input.stockItemId, locationId: input.toLocationId } },
          create: { stockItemId: input.stockItemId, locationId: input.toLocationId, quantity: input.quantity },
          update: { quantity: { increment: input.quantity } }
        });
      }

      const movement = await tx.stockMovement.create({ data: input });
      await tx.activityLog.create({
        data: {
          entityType: 'StockItem',
          entityId: input.stockItemId,
          action: 'STOCK_MOVED',
          message: `${input.quantity} unidades movidas: ${input.reason}`,
          userId: input.userId,
          metadataJson: input
        }
      });
      return movement;
    });
  }

  async setStockQuantityBySku(sku: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0) throw new BadRequestException('La cantidad debe ser 0 o positiva');
    const item = await this.prisma.stockItem.findUniqueOrThrow({ where: { sku }, include: { levels: true } });
    const location = await this.prisma.stockLocation.findUniqueOrThrow({ where: { code: 'EST-A-01' } });
    const currentTotal = item.levels.reduce((sum, level) => sum + level.quantity, 0);
    const delta = quantity - currentTotal;

    return this.prisma.$transaction(async (tx) => {
      for (const level of item.levels) {
        if (level.locationId !== location.id && level.quantity !== 0) {
          await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: 0 } });
        }
      }

      const level = await tx.stockLevel.upsert({
        where: { stockItemId_locationId: { stockItemId: item.id, locationId: location.id } },
        create: { stockItemId: item.id, locationId: location.id, quantity },
        update: { quantity }
      });

      if (delta !== 0) {
        const movementInput = {
          stockItemId: item.id,
          fromLocationId: delta < 0 ? location.id : undefined,
          toLocationId: delta > 0 ? location.id : undefined,
          quantity: Math.abs(delta),
          reason: 'AJUSTE_STOCK_MANUAL'
        };
        await tx.stockMovement.create({ data: movementInput });
        await tx.activityLog.create({
          data: {
            entityType: 'StockItem',
            entityId: item.id,
            action: 'STOCK_SET',
            message: `Stock ajustado manualmente de ${currentTotal} a ${quantity}`,
            metadataJson: { sku, previousQuantity: currentTotal, quantity }
          }
        });
      }

      return tx.stockItem.findUniqueOrThrow({ where: { id: item.id }, include: { levels: { include: { location: true } } } });
    });
  }

  async reserveStockForOrder(orderId: string) {
    await this.activity.log({ entityType: 'Order', entityId: orderId, action: 'STOCK_RESERVED', message: 'Reserva de stock registrada' });
    return { orderId, reserved: true };
  }

  async releaseStockForCancelledOrder(orderId: string) {
    await this.activity.log({ entityType: 'Order', entityId: orderId, action: 'STOCK_RELEASED', message: 'Liberacion de stock registrada' });
    return { orderId, released: true };
  }

  getLowStockItems() {
    return this.prisma.stockItem.findMany({
      where: { levels: { some: { quantity: { lte: 3 } } } },
      include: { levels: { include: { location: true } } }
    });
  }

  getBlockedOrdersDueToStock() {
    return this.prisma.order.findMany({ where: { operationalStatus: 'WAITING_STOCK' }, include: { items: true } });
  }
}
