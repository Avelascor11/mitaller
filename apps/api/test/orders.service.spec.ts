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

  it('cancela lineas eliminadas en Shopify y crea la nueva talla sin dejar la antigua en compras', async () => {
    const existingOrder = {
      id: 'order-1',
      shopifyOrderId: 'gid://shopify/Order/9510',
      orderNumber: '#9510',
      operationalStatus: 'WAITING_PICKING',
      priorityLevel: 'NORMAL',
      internalDeadlineAt: new Date('2026-05-14T10:00:00Z'),
      shipments: []
    };
    const oldItem = {
      id: 'item-old',
      orderId: 'order-1',
      shopifyLineItemId: 'gid://shopify/LineItem/old',
      shopifyProductId: 'gid://shopify/Product/1',
      shopifyVariantId: 'gid://shopify/ProductVariant/old-s',
      sku: 'CAM-BLANCA-S',
      title: 'Camiseta Blanca',
      variantTitle: 'S',
      quantity: 1,
      imageUrl: null,
      imageUrlsJson: [],
      color: 'Blanca',
      size: 'S',
      productType: 'Camiseta',
      unitPrice: 20,
      lineDiscount: 0,
      status: 'PENDING'
    };
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue(existingOrder),
        upsert: vi.fn().mockResolvedValue(existingOrder),
        findFirstOrThrow: vi.fn().mockResolvedValue({ ...existingOrder, items: [], shipments: [] })
      },
      orderItem: {
        findMany: vi.fn()
          .mockResolvedValueOnce([oldItem])
          .mockResolvedValueOnce([{ ...oldItem, id: 'item-new', shopifyLineItemId: 'gid://shopify/LineItem/new', shopifyVariantId: 'gid://shopify/ProductVariant/new-m', sku: 'CAM-BLANCA-M', size: 'M' }]),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({})
      },
      productionTask: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };

    await serviceWith(prisma).upsertImportedOrder({
      shopifyOrderId: 'gid://shopify/Order/9510',
      orderNumber: '#9510',
      customerName: 'Cliente',
      customerEmail: 'cliente@example.com',
      shippingMethod: 'Correos Estandar',
      shippingCountry: 'ES',
      shippingAddressJson: {},
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      operationalStatus: 'WAITING_PICKING',
      orderedAt: new Date('2026-05-14T09:00:00Z'),
      items: [{
        shopifyLineItemId: 'gid://shopify/LineItem/new',
        shopifyProductId: 'gid://shopify/Product/1',
        shopifyVariantId: 'gid://shopify/ProductVariant/new-m',
        sku: 'CAM-BLANCA-M',
        title: 'Camiseta Blanca',
        variantTitle: 'M',
        quantity: 1,
        color: 'Blanca',
        size: 'M',
        productType: 'Camiseta',
        unitPrice: 20,
        lineDiscount: 0
      }]
    });

    expect(prisma.orderItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shopifyLineItemId: 'gid://shopify/LineItem/new',
        sku: 'CAM-BLANCA-M',
        size: 'M'
      })
    }));
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-old' },
      data: { status: 'CANCELLED' }
    });
    expect(prisma.productionTask.deleteMany).toHaveBeenCalledWith({ where: { orderId: 'order-1' } });
    expect(prisma.productionTask.createMany).toHaveBeenCalled();
  });
});
