import { describe, expect, it } from 'vitest';
import { ShopifyAdapter } from '../src/shopify/shopify.adapter';

describe('ShopifyAdapter', () => {
  it('ignora lineas eliminadas en un webhook de pedido actualizado', () => {
    const adapter = new ShopifyAdapter({ get: () => undefined } as never);

    const order = adapter.mapWebhookOrder({
      id: 123,
      admin_graphql_api_id: 'gid://shopify/Order/123',
      name: '#9500',
      created_at: '2026-05-12T10:00:00Z',
      line_items: [
        {
          id: 1,
          admin_graphql_api_id: 'gid://shopify/LineItem/1',
          title: 'Camiseta talla equivocada',
          quantity: 1,
          current_quantity: 0
        },
        {
          id: 2,
          admin_graphql_api_id: 'gid://shopify/LineItem/2',
          title: 'Camiseta talla correcta',
          quantity: 1,
          current_quantity: 1
        }
      ]
    });

    expect(order?.items).toHaveLength(1);
    expect(order?.items[0].title).toBe('Camiseta talla correcta');
  });

  it('usa la cantidad actual cuando Shopify cambia unidades por edicion', () => {
    const adapter = new ShopifyAdapter({ get: () => undefined } as never);

    const order = adapter.mapWebhookOrder({
      id: 124,
      admin_graphql_api_id: 'gid://shopify/Order/124',
      name: '#9501',
      line_items: [
        {
          id: 3,
          title: 'Camiseta editada',
          quantity: 4,
          current_quantity: 2
        }
      ]
    });

    expect(order?.items[0].quantity).toBe(2);
  });
});
