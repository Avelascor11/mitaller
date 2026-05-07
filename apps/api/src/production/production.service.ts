import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriorityLevel, ProductionTaskStatus } from '@prisma/client';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';

const priorityWeight: Record<PriorityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
  BLOCKED: 4
};

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService
  ) {}

  async findAll() {
    const tasks = await this.prisma.productionTask.findMany({ include: { order: true, orderItem: true } });
    return this.filterOperationalTasks(tasks);
  }

  async priorityQueue() {
    const tasks = await this.prisma.productionTask.findMany({
      where: {
        status: { in: [ProductionTaskStatus.PENDING, ProductionTaskStatus.IN_PROGRESS] },
        orderItemId: { not: null }
      },
      include: { order: true, orderItem: true }
    });
    return this.filterOperationalTasks(tasks)
      .sort((a, b) => priorityWeight[a.priorityLevel] - priorityWeight[b.priorityLevel] || Number(a.internalDeadlineAt ?? 0) - Number(b.internalDeadlineAt ?? 0));
  }

  async start(id: string) {
    const task = await this.prisma.productionTask.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    await this.activity.log({ entityType: 'ProductionTask', entityId: id, action: 'STARTED', message: `Tarea iniciada: ${task.title}` });
    return task;
  }

  async complete(id: string) {
    const task = await this.prisma.productionTask.update({ where: { id }, data: { status: 'DONE', completedAt: new Date() } });
    await this.activity.log({ entityType: 'ProductionTask', entityId: id, action: 'DONE', message: `Tarea completada: ${task.title}` });
    return task;
  }

  async block(id: string, reason: string) {
    const task = await this.prisma.productionTask.update({ where: { id }, data: { status: 'BLOCKED', priorityLevel: 'BLOCKED', blockedReason: reason } });
    await this.activity.log({ entityType: 'ProductionTask', entityId: id, action: 'BLOCKED', message: reason });
    return task;
  }

  private filterOperationalTasks<T extends { title: string; orderItemId: string | null; order: { orderNumber: string } }>(tasks: T[]) {
    const minimum = Number(this.config.get('SHOPIFY_MIN_ORDER_NUMBER') ?? 0);
    return tasks.filter((task) => {
      if (!task.orderItemId) return false;
      if (minimum && this.orderNumberValue(task.order.orderNumber) < minimum) return false;
      return task.title.startsWith('Fabricar ') || task.title.startsWith('Picking ');
    });
  }

  private orderNumberValue(orderNumber: string) {
    return Number(orderNumber.replace(/\D/g, '')) || 0;
  }
}
