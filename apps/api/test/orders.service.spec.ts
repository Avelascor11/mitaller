import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../src/orders/orders.service';

function serviceWith(prisma: Record<string, any>) {
  return new OrdersService(
    prisma as never,
    {
      calculate: vi.fn(() => ({
        operationalStatus: 'WAITING_PICKING',
        priorityLevel: 'NORMAL',
        internalDeadlineAt: new Date('2026-05-14T10:00:00Z')
      }))
    } as never,
    { importRecentOrders: vi.fn(), hasCredentials: vi.fn(() => true) } as never,
    { buildTasks: vi.fn(() => []) } as never,
    { log: vi.fn() } as never,
    { get: vi.fn(() => undefined) } as never
  );
}

describe('OrdersService', () => {
  it('cancela etiquetas pendientes cuando devuelve un pedido a sin preparar', async () => {
    const order = {
      id: 'order-1',
      orderNumber: '#9500',
      shopifyOrderId: 'gid://shopify/Order/9500',
      operationalStatus: 'LABEL_CREATED',
      items: [],
      shipments: [{ id: 'shipment-1', status: 'LABEL_CREATED' }]
    };
    const prisma = {
      order: {
        findFirstOrThrow: vi.fn().mockResolvedValue(order),
        update: vi.fn().mockResolvedValue({ ...order, operationalStatus: 'WAITING_PICKING', preparedAt: null })
      },
      stockMovement: { findMany: vi.fn().mockResolvedValue([]) },
      shipment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    };

    await serviceWith(prisma).reopenPreparation('#9500');

    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        status: { in: ['PENDING', 'PARCEL_CREATED', 'LABEL_CREATED', 'PRINTED', 'ERROR'] }
      },
      data: { status: 'CANCELLED' }
    });
    expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      data: { operationalStatus: 'WAITING_PICKING', preparedAt: null }
    }));
  });

  it('no vuelve a enviar a Envios un pedido reabierto aunque conserve una etiqueta vieja', async () => {
    const existingOrder = {
      id: 'order-1',
      shopifyOrderId: 'gid://shopify/Order/9501',
      orderNumber: '#9501',
      operationalStatus: 'WAITING_PICKING',
      shipments: [{ id: 'shipment-1', status: 'LABEL_CREATED' }]
    };
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue(existingOrder),
        upsert: vi.fn().mockResolvedValue(existingOrder),
        findFirstOrThrow: vi.fn().mockResolvedValue({ ...existingOrder, items: [], shipments: existingOrder.shipments })
      },
      orderItem: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([])
      },
      productionTask: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 })
      }
    };

    await serviceWith(prisma).upsertImportedOrder({
      shopifyOrderId: 'gid://shopify/Order/9501',
      orderNumber: '#9501',
      customerName: 'Cliente',
      customerEmail: 'cliente@example.com',
      shippingMethod: 'Correos Estandar',
      shippingCountry: 'ES',
      shippingAddressJson: {},
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      operationalStatus: 'WAITING_PICKING',
      orderedAt: new Date('2026-05-14T09:00:00Z'),
      items: []
    });

    expect(prisma.order.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        operationalStatus: 'WAITING_PICKING'
      })
    }));
  });
});
