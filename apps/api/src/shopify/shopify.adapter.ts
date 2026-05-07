import { BadGatewayException, BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { ImportedOrder } from '../orders/orders.service';

@Injectable()
export class ShopifyAdapter {
  constructor(private readonly config: ConfigService) {}

  hasCredentials() {
    return Boolean(this.shopDomain && this.accessToken);
  }

  async importRecentOrders(): Promise<ImportedOrder[]> {
    this.assertConfigured();

    const importLimit = Math.min(Number(this.config.get('SHOPIFY_IMPORT_ORDER_LIMIT') ?? 100), 250);
    const minimumOrderNumber = Number(this.config.get('SHOPIFY_MIN_ORDER_NUMBER') ?? 0);
    const orders: ShopifyOrderNode[] = [];
    let after: string | null = null;

    while (orders.length < importLimit) {
      const data: ShopifyOrdersResponse = await this.graphql<ShopifyOrdersResponse>(`
        query RecentOrders($first: Int!, $after: String, $query: String!) {
          orders(first: $first, after: $after, reverse: true, sortKey: CREATED_AT, query: $query) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              name
              createdAt
              email
              displayFinancialStatus
              displayFulfillmentStatus
              cancelledAt
              customer {
                displayName
                email
              }
              shippingAddress {
                name
                address1
                address2
                city
                province
                zip
                countryCodeV2
                phone
              }
              shippingLine {
                title
                code
              }
              lineItems(first: 100) {
                nodes {
                  id
                  title
                  quantity
                  sku
                  variantTitle
                  product {
                    id
                    productType
                    featuredImage {
                      url
                    }
                    media(first: 2) {
                      nodes {
                        ... on MediaImage {
                          image {
                            url
                          }
                        }
                      }
                    }
                  }
                  variant {
                    id
                    sku
                    title
                    image {
                      url
                    }
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
            }
          }
        }
      `, {
        first: Math.min(50, importLimit - orders.length),
        after,
        query: 'status:open'
      });

      orders.push(...data.orders.nodes);
      const reachedMinimum = minimumOrderNumber > 0
        && data.orders.nodes.some((order) => this.orderNumberValue(order.name) < minimumOrderNumber);
      if (reachedMinimum) break;
      if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) break;
      after = data.orders.pageInfo.endCursor;
    }

    return orders
      .filter((order) => !order.cancelledAt && (order.displayFulfillmentStatus ?? '').toUpperCase() !== 'FULFILLED')
      .filter((order) => !minimumOrderNumber || this.orderNumberValue(order.name) >= minimumOrderNumber)
      .map((order) => this.mapGraphqlOrder(order));
  }

  async importProducts() {
    this.assertConfigured();
    const data = await this.graphql<ShopifyProductsResponse>(`
      query Products($first: Int!) {
        products(first: $first, reverse: true, sortKey: UPDATED_AT) {
          nodes {
            id
            title
            productType
            vendor
            variants(first: 50) {
              nodes {
                id
                title
                sku
              }
            }
          }
        }
      }
    `, { first: 50 });
    return { mode: 'real', products: data.products.nodes };
  }

  async handleOrderCreatedWebhook(payload: unknown) {
    return { received: true, order: this.mapWebhookOrder(payload) };
  }

  async handleOrderUpdatedWebhook(payload: unknown) {
    return { received: true, order: this.mapWebhookOrder(payload) };
  }

  async updateFulfillmentTracking(orderId: string, trackingNumber: string, carrier: string) {
    if (!orderId.startsWith('gid://shopify/Order/')) {
      return { mode: 'skipped', orderId, trackingNumber, carrier, note: 'Pedido interno o importado desde hoja; no se actualiza Shopify.' };
    }
    this.assertConfigured();

    const numericOrderId = orderId.split('/').pop();
    if (!numericOrderId) {
      throw new BadRequestException('ID de pedido Shopify no valido para fulfillment.');
    }

    const fulfillmentOrders = await this.rest<{ fulfillment_orders?: ShopifyFulfillmentOrder[] }>(
      `/orders/${numericOrderId}/fulfillment_orders.json`,
      { method: 'GET' }
    );
    const openFulfillmentOrders = (fulfillmentOrders.fulfillment_orders ?? []).filter((fulfillmentOrder) =>
      ['open', 'in_progress', 'scheduled'].includes(String(fulfillmentOrder.status ?? '').toLowerCase())
    );

    if (!openFulfillmentOrders.length) {
      return { mode: 'skipped', orderId, trackingNumber, carrier, note: 'Shopify no tiene fulfillment orders abiertos para este pedido.' };
    }

    const response = await this.rest<ShopifyFulfillmentCreateResponse>('/fulfillments.json', {
      method: 'POST',
      body: JSON.stringify({
        fulfillment: {
          line_items_by_fulfillment_order: openFulfillmentOrders.map((fulfillmentOrder) => ({
            fulfillment_order_id: fulfillmentOrder.id
          })),
          tracking_info: {
            number: trackingNumber,
            company: carrier
          },
          notify_customer: false
        }
      })
    });

    return {
      mode: 'fulfilled',
      orderId,
      trackingNumber,
      carrier,
      fulfillmentId: response.fulfillment?.id
    };
  }

  async getOrderById(id: string) {
    this.assertConfigured();
    const data = await this.graphql<{ order: ShopifyOrderNode | null }>(`
      query OrderById($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          email
          displayFinancialStatus
          displayFulfillmentStatus
          cancelledAt
          customer { displayName email }
          shippingAddress { name address1 address2 city province zip countryCodeV2 phone }
          shippingLine { title code }
          lineItems(first: 100) {
            nodes {
              id title quantity sku variantTitle
              product { id productType featuredImage { url } media(first: 2) { nodes { ... on MediaImage { image { url } } } } }
              variant { id sku title image { url } selectedOptions { name value } }
            }
          }
        }
      }
    `, { id });
    return data.order ? this.mapGraphqlOrder(data.order) : null;
  }

  assertValidWebhook(rawBody?: Buffer, hmacHeader?: string) {
    const secret = this.config.get<string>('SHOPIFY_WEBHOOK_SECRET');
    if (!secret) return;
    if (!rawBody || !hmacHeader) {
      throw new UnauthorizedException('Firma webhook Shopify ausente');
    }
    const digest = createHmac('sha256', secret).update(rawBody).digest('base64');
    const expected = Buffer.from(digest);
    const received = Buffer.from(hmacHeader);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Firma webhook Shopify no valida');
    }
  }

  mapWebhookOrder(payload: unknown): ImportedOrder | null {
    if (!payload || typeof payload !== 'object') return null;
    const order = payload as ShopifyWebhookOrder;
    const orderId = order.admin_graphql_api_id ?? String(order.id ?? '');
    if (!orderId) throw new BadRequestException('Webhook Shopify sin id de pedido');
    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    const shippingLine = Array.isArray(order.shipping_lines) ? order.shipping_lines[0] : undefined;
    const address = order.shipping_address;

    return {
      shopifyOrderId: orderId,
      orderNumber: order.name ?? `#${order.order_number ?? order.id}`,
      customerName: address?.name ?? (`${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim() || 'Cliente Shopify'),
      customerEmail: order.email ?? order.customer?.email,
      shippingMethod: shippingLine?.title ?? 'Sin metodo de envio',
      shippingCountry: address?.country_code,
      shippingAddressJson: address ?? null,
      financialStatus: order.financial_status ?? 'unknown',
      fulfillmentStatus: order.fulfillment_status ?? 'unfulfilled',
      operationalStatus: order.cancelled_at ? 'CANCELLED' : undefined,
      orderedAt: order.created_at ? new Date(order.created_at) : new Date(),
      items: lineItems.map((item) => this.mapWebhookLineItem(item))
    };
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken
        },
        body: JSON.stringify({ query, variables })
      });
    } catch (error) {
      throw new BadGatewayException(`No se pudo conectar con Shopify (${this.shopDomain}). Revisa SHOPIFY_SHOP_DOMAIN.`);
    }

    const json = await response.json() as ShopifyGraphqlResponse<T>;
    if (!response.ok || json.errors?.length) {
      throw new BadGatewayException(`Shopify API error: ${JSON.stringify(json.errors ?? json)}`);
    }
    return json.data;
  }

  private async rest<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://${this.shopDomain}/admin/api/${this.apiVersion}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken,
          ...init.headers
        }
      });
    } catch {
      throw new BadGatewayException(`No se pudo conectar con Shopify (${this.shopDomain}). Revisa SHOPIFY_SHOP_DOMAIN.`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BadGatewayException(`Shopify API error ${response.status}: ${JSON.stringify(json)}`);
    }
    return json as T;
  }

  private mapGraphqlOrder(order: ShopifyOrderNode): ImportedOrder {
    const address = order.shippingAddress;
    const shippingMethod = order.shippingLine?.title ?? order.shippingLine?.code ?? 'Sin metodo de envio';
    return {
      shopifyOrderId: order.id,
      orderNumber: order.name,
      customerName: address?.name ?? order.customer?.displayName ?? 'Cliente Shopify',
      customerEmail: order.email ?? order.customer?.email,
      shippingMethod,
      shippingCountry: address?.countryCodeV2,
      shippingAddressJson: address ?? null,
      financialStatus: order.displayFinancialStatus?.toLowerCase() ?? 'unknown',
      fulfillmentStatus: order.displayFulfillmentStatus?.toLowerCase() ?? 'unfulfilled',
      operationalStatus: order.cancelledAt ? 'CANCELLED' : undefined,
      orderedAt: new Date(order.createdAt),
      items: order.lineItems.nodes.map((item) => this.mapGraphqlLineItem(item))
    };
  }

  private mapGraphqlLineItem(item: ShopifyLineItemNode): ImportedOrder['items'][number] {
    const options = item.variant?.selectedOptions ?? [];
    const getOption = (name: string) => options.find((option) => option.name.toLowerCase() === name)?.value;
    const imageUrls = this.lineItemImageUrls(item);
    return {
      shopifyLineItemId: item.id,
      shopifyProductId: item.product?.id ?? item.variant?.product?.id,
      shopifyVariantId: item.variant?.id,
      sku: item.sku || item.variant?.sku || `NO-SKU-${item.id.split('/').pop()}`,
      title: item.title,
      variantTitle: item.variantTitle ?? item.variant?.title,
      quantity: item.quantity,
      imageUrl: imageUrls[0],
      imageUrlsJson: imageUrls,
      color: getOption('color') ?? getOption('colour'),
      size: getOption('size') ?? getOption('talla'),
      productType: item.product?.productType ?? item.variant?.product?.productType
    };
  }

  private mapWebhookLineItem(item: ShopifyWebhookLineItem): ImportedOrder['items'][number] {
    const properties = Array.isArray(item.properties) ? item.properties : [];
    const getProperty = (name: string) => properties.find((property) => property.name?.toLowerCase() === name)?.value;
    return {
      shopifyLineItemId: item.admin_graphql_api_id ?? String(item.id ?? ''),
      shopifyProductId: item.product_id ? `gid://shopify/Product/${item.product_id}` : undefined,
      shopifyVariantId: item.variant_id ? `gid://shopify/ProductVariant/${item.variant_id}` : undefined,
      sku: item.sku || `NO-SKU-${item.id}`,
      title: item.title ?? item.name ?? 'Producto Shopify',
      variantTitle: item.variant_title,
      quantity: item.quantity ?? 1,
      imageUrl: undefined,
      imageUrlsJson: [],
      color: getProperty('Color') ?? getProperty('color'),
      size: getProperty('Size') ?? getProperty('Talla') ?? getProperty('size'),
      productType: item.product_type
    };
  }

  private get shopDomain() {
    return String(this.config.get('SHOPIFY_SHOP_DOMAIN') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  private get accessToken() {
    return String(this.config.get('SHOPIFY_ADMIN_ACCESS_TOKEN') ?? '');
  }

  private get apiVersion() {
    return this.config.get<string>('SHOPIFY_API_VERSION') ?? '2026-04';
  }

  private assertConfigured() {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Shopify no esta configurado. Define SHOPIFY_SHOP_DOMAIN y SHOPIFY_ADMIN_ACCESS_TOKEN.');
    }
  }

  private orderNumberValue(orderNumber: string) {
    return Number(orderNumber.replace(/\D/g, '')) || 0;
  }

  private lineItemImageUrls(item: ShopifyLineItemNode) {
    const urls = [
      item.variant?.image?.url,
      item.product?.featuredImage?.url,
      item.variant?.product?.featuredImage?.url,
      ...(item.product?.media?.nodes ?? []).map((node) => node.image?.url),
      ...(item.variant?.product?.media?.nodes ?? []).map((node) => node.image?.url)
    ].filter((url): url is string => Boolean(url));
    return [...new Set(urls)].slice(0, 2);
  }
}

interface ShopifyGraphqlResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

interface ShopifyFulfillmentOrder {
  id: number;
  status?: string;
}

interface ShopifyFulfillmentCreateResponse {
  fulfillment?: {
    id?: number;
  };
}

interface ShopifyOrdersResponse {
  orders: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
    nodes: ShopifyOrderNode[];
  };
}

interface ShopifyProductsResponse {
  products: { nodes: unknown[] };
}

interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  email?: string;
  displayFinancialStatus?: string;
  displayFulfillmentStatus?: string;
  cancelledAt?: string | null;
  customer?: { displayName?: string; email?: string } | null;
  shippingAddress?: ShopifyAddress | null;
  shippingLine?: { title?: string; code?: string } | null;
  lineItems: { nodes: ShopifyLineItemNode[] };
}

interface ShopifyLineItemNode {
  id: string;
  title: string;
  quantity: number;
  sku?: string;
  variantTitle?: string;
  product?: ShopifyProductRef | null;
  variant?: {
    id: string;
    sku?: string;
    title?: string;
    image?: { url?: string } | null;
    selectedOptions?: Array<{ name: string; value: string }>;
    product?: ShopifyProductRef | null;
  } | null;
}

interface ShopifyProductRef {
  id: string;
  productType?: string;
  featuredImage?: { url?: string } | null;
  media?: { nodes: Array<{ image?: { url?: string } | null }> };
}

interface ShopifyAddress {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  countryCodeV2?: string;
  phone?: string;
}

interface ShopifyWebhookOrder {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  order_number?: number | string;
  email?: string;
  created_at?: string;
  cancelled_at?: string | null;
  financial_status?: string;
  fulfillment_status?: string;
  customer?: { first_name?: string; last_name?: string; email?: string };
  shipping_address?: {
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country_code?: string;
    phone?: string;
  };
  shipping_lines?: Array<{ title?: string; code?: string }>;
  line_items?: ShopifyWebhookLineItem[];
}

interface ShopifyWebhookLineItem {
  id?: number | string;
  admin_graphql_api_id?: string;
  product_id?: number | string;
  variant_id?: number | string;
  sku?: string;
  title?: string;
  name?: string;
  variant_title?: string;
  quantity?: number;
  product_type?: string;
  properties?: Array<{ name?: string; value?: string }>;
}
