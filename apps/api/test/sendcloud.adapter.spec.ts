import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendcloudAdapter } from '../src/sendcloud/sendcloud.adapter';

const baseConfig: Record<string, string> = {
  SENDCLOUD_PUBLIC_KEY: 'public',
  SENDCLOUD_SECRET_KEY: 'secret',
  SENDCLOUD_API_V3_BASE_URL: 'https://panel.sendcloud.sc/api/v3',
  SENDCLOUD_STANDARD_SHIPPING_OPTION_CODE: 'correos:standard',
  SENDCLOUD_FROM_NAME: 'Mitaller',
  SENDCLOUD_FROM_ADDRESS_LINE_1: 'Calle Taller',
  SENDCLOUD_FROM_HOUSE_NUMBER: '1',
  SENDCLOUD_FROM_POSTAL_CODE: '28001',
  SENDCLOUD_FROM_CITY: 'Madrid',
  SENDCLOUD_FROM_COUNTRY_CODE: 'ES'
};

function adapter(config: Record<string, string | undefined> = {}) {
  return new SendcloudAdapter({ get: (key: string) => config[key] ?? baseConfig[key] } as never);
}

const order = {
  id: 'order-1',
  orderNumber: '#9490',
  customerName: 'Ainoa Sola Paredes',
  customerEmail: 'cliente@example.com',
  shippingMethod: 'Correos Estandar',
  shippingAddressJson: {
    name: 'Ainoa Sola Paredes',
    address1: 'Calle Cliente 2',
    city: 'Madrid',
    zip: '28002',
    countryCodeV2: 'ES'
  },
  items: []
};

describe('SendcloudAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crea etiquetas con API v3 y shipping_option_code explicito', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: 'shipment-1',
          carrier: { code: 'correos', name: 'Correos' },
          ship_with: { properties: { shipping_option_code: 'correos:standard' } },
          parcels: [
            {
              id: 123,
              tracking_number: 'PQ123',
              documents: [{ type: 'label', link: 'https://panel.sendcloud.sc/api/v3/parcels/123/documents/label' }]
            }
          ]
        }
      })
    } as Response);

    const result = await adapter().createShipment(order);
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(String(url)).toBe('https://panel.sendcloud.sc/api/v3/shipments/announce');
    expect(body.ship_with.properties.shipping_option_code).toBe('correos:standard');
    expect(body.label_details.dpi).toBe(72);
    expect(result.carrier).toBe('Correos');
    expect(result.trackingNumber).toBe('PQ123');
  });

  it('normaliza el DPI a 72 aunque este configurado otro valor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: 'shipment-1',
          carrier: { code: 'correos', name: 'Correos' },
          ship_with: { properties: { shipping_option_code: 'correos:standard' } },
          parcels: [
            {
              id: 123,
              tracking_number: 'PQ123',
              documents: [{ type: 'label', link: 'https://panel.sendcloud.sc/api/v3/parcels/123/documents/label' }]
            }
          ]
        }
      })
    } as Response);

    await adapter({ SENDCLOUD_LABEL_DPI: '203' }).createShipment(order);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.label_details.dpi).toBe(72);
  });

  it('bloquea etiquetas Unstamped letter aunque Sendcloud las devuelva como correctas', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: 'shipment-letter',
          carrier: { code: 'sendcloud', name: 'Sendcloud' },
          ship_with: { properties: { shipping_option_code: 'sendcloud:letter' } },
          parcels: [{ id: 8, tracking_number: 'SCCWF3PQK29Q' }]
        }
      })
    } as Response);

    await expect(adapter().createShipment(order)).rejects.toThrow(/carta sin sello/i);
  });
});
