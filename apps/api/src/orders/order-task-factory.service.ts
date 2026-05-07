import { Injectable } from '@nestjs/common';
import { Order, OrderItem, Prisma } from '@prisma/client';

@Injectable()
export class OrderTaskFactoryService {
  buildTasks(order: Order, items: OrderItem[]): Prisma.ProductionTaskCreateManyInput[] {
    const tasks: Prisma.ProductionTaskCreateManyInput[] = items.flatMap((item) => {
      const productType = item.productType?.toLowerCase() ?? '';
      const isManufactured = productType.includes('camiseta') || productType.includes('sudadera') || productType.includes('textil');
      if (!isManufactured) {
        return [{
          orderId: order.id,
          orderItemId: item.id,
          title: `Picking ${item.title}`,
          sku: item.sku,
          productName: item.title,
          color: item.color,
          size: item.size,
          quantity: item.quantity,
          priorityLevel: order.priorityLevel,
          internalDeadlineAt: order.internalDeadlineAt
        }];
      }
      return [{
        orderId: order.id,
        orderItemId: item.id,
        title: `Fabricar ${item.title}`,
        sku: item.sku,
        productName: item.title,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        priorityLevel: order.priorityLevel,
        internalDeadlineAt: order.internalDeadlineAt
      }];
    });

    return tasks;
  }
}
