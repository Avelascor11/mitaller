import { describe, expect, it } from 'vitest';
import { OrderTaskFactoryService } from '../src/orders/order-task-factory.service';

describe('OrderTaskFactoryService', () => {
  it('crea solo tareas de fabricacion y picking para la cola del taller', () => {
    const service = new OrderTaskFactoryService();
    const order = { id: 'order-1', orderNumber: '#9466', priorityLevel: 'HIGH', internalDeadlineAt: new Date() } as never;
    const tasks = service.buildTasks(order, [
      { id: 'item-1', orderId: 'order-1', title: 'Camiseta Fernando', sku: 'TS-F', productType: 'Camiseta', quantity: 1, color: 'Negro', size: 'L' },
      { id: 'item-2', orderId: 'order-1', title: 'Pegatina Magic Alonso', sku: 'ST-MA', productType: 'Pegatina', quantity: 2 }
    ] as never);
    expect(tasks.map((task) => task.title)).toContain('Fabricar Camiseta Fernando');
    expect(tasks.map((task) => task.title)).toContain('Picking Pegatina Magic Alonso');
    expect(tasks).toHaveLength(2);
  });
});
