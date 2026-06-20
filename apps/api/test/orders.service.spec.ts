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
  it('archiva pedidos de preventa retro para sacarlos de sin preparar', async () => {
    const orders = [
      {
        id: 'order-retro',
        orderNumber: '#9580',
        items: [{
          id: 'item-retro',
          title: 'Camiseta Retro Aston',
          variantTitle: 'Blanca - M',
          sku: 'RETRO-ASTON-M',
          productType: 'Camiseta',
          status: 'PENDING'
        }]
      },
      {
        id: 'order-sweat',
        orderNumber: '#9581',
        items: [{
          id: 'item-sweat',
          title: 'Sudadera Retro Aston',
          variantTitle: 'Mastic - M',
          sku: 'RETRO-SUD-M',
          productType: 'Sudadera',
          status: 'PENDING'
        }]
      }
    ];
    const prisma = {
      order: {
        findMany: vi.fn().mockResolvedValue(orders),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      productionTask: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    const activity = { log: vi.fn() };

    const result = await new OrdersService(
      prisma as never,
      { calculate: vi.fn() } as never,
      { importRecentOrders: vi.fn(), hasCredentials: vi.fn(() => true) } as never,
      { buildTasks: vi.fn(() => []) } as never,
      activity as never,
      { get: vi.fn(() => undefined) } as never
    ).archiveRetroPreorderOrders();

    expect(result).toEqual({ archived: 1, orders: [{ id: 'order-retro', orderNumber: '#9580' }] });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['order-retro'] } },
      data: expect.objectContaining({
        operationalStatus: 'SHIPPED',
        fulfillmentStatus: 'fulfilled'
      })
    });
    expect(prisma.productionTask.updateMany).toHaveBeenCalledWith({
      where: { orderId: { in: ['order-retro'] } },
      data: expect.objectContaining({ status: 'DONE' })
    });
    expect(activity.log).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'Order',
      entityId: 'order-retro',
      action: 'RETRO_PREORDER_ARCHIVED'
    }));
  });

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

  it('mueve una prenda mala a MALAS y descuenta stock bueno del pedido', async () => {
    const order = {
      id: 'order-9599',
      orderNumber: '#9599',
      shopifyOrderId: 'gid://shopify/Order/9599',
      items: [],
      shipments: []
    };
    const activity = { log: vi.fn() };
    const prisma = {
      order: {
        findFirstOrThrow: vi.fn().mockResolvedValue(order)
      },
      stockItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'stock-xl',
          sku: 'CAM-BLANCA-XL',
          name: 'Camiseta Blanca - XL',
          levels: [{
            id: 'level-good',
            locationId: 'loc-est-a-01',
            quantity: 2,
            location: { id: 'loc-est-a-01', code: 'EST-A-01' }
          }]
        })
      },
      stockLocation: {
        upsert: vi.fn().mockResolvedValue({ id: 'loc-malas', code: 'MALAS', name: 'Malas', type: 'INCIDENTS' })
      },
      stockLevel: {
        update: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({})
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'movement-1' })
      }
    };

    await new OrdersService(
      prisma as never,
      { calculate: vi.fn() } as never,
      { importRecentOrders: vi.fn(), hasCredentials: vi.fn(() => true) } as never,
      { buildTasks: vi.fn(() => []) } as never,
      activity as never,
      { get: vi.fn(() => undefined) } as never
    ).markDamagedGarment('#9599', {
      stockItemId: 'stock-xl',
      quantity: 1,
      reason: 'Se ha manchado'
    });

    expect(prisma.stockLocation.upsert).toHaveBeenCalledWith({
      where: { code: 'MALAS' },
      update: { name: 'Malas', type: 'INCIDENTS' },
      create: { code: 'MALAS', name: 'Malas', type: 'INCIDENTS' }
    });
    expect(prisma.stockLevel.update).toHaveBeenCalledWith({
      where: { id: 'level-good' },
      data: { quantity: { decrement: 1 } }
    });
    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith({
      where: { stockItemId_locationId: { stockItemId: 'stock-xl', locationId: 'loc-malas' } },
      create: { stockItemId: 'stock-xl', locationId: 'loc-malas', quantity: 1 },
      update: { quantity: { increment: 1 } }
    });
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        stockItemId: 'stock-xl',
        fromLocationId: 'loc-est-a-01',
        toLocationId: 'loc-malas',
        quantity: 1,
        reason: 'DAMAGED_GARMENT',
        relatedOrderId: 'order-9599'
      }
    });
    expect(activity.log).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'Order',
      entityId: 'order-9599',
      action: 'DAMAGED_GARMENT_RECORDED',
      metadataJson: expect.objectContaining({
        stockItemId: 'stock-xl',
        quantity: 1,
        reason: 'Se ha manchado'
      })
    }));
  });
});
