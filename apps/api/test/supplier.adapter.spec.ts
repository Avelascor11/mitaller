import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupplierAdapter } from '../src/supplier/supplier.adapter';

function adapterWith(config: Record<string, string>) {
  return new SupplierAdapter(
    {} as never,
    { get: (key: string) => config[key] } as never
  );
}

const payload = {
  supplier: 'FALK_ROSS',
  orderNumber: 'FR-20260602',
  requestedAt: '2026-06-02T18:00:00.000Z',
  source: 'test',
  orderNote: 'Mitaller: revisar precios antes de confirmar. Camiseta 032.42 -> 2.73 EUR',
  lines: [
    { supplierSku: '180000002', name: 'Camiseta Blanca - M', quantity: 3, color: 'BLANCA', size: 'M' }
  ]
};

describe('SupplierAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crea borrador si el pedido real no esta activado', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await adapterWith({ FALKROSS_AUTO_ORDER_ENABLED: 'false' }).submitPurchaseOrder(payload);

    expect(result.submitted).toBe(false);
    expect(result.mode).toBe('draft');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('envia pedido XML a Falk & Ross con Basic Auth cuando esta activado', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<order><webservice_order_number>WS-123</webservice_order_number></order>'
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await adapterWith({
      FALKROSS_AUTO_ORDER_ENABLED: 'true',
      FALKROSS_ORDER_MODE: 'falkross-xml',
      FALKROSS_WEBSERVICE_USER: 'user',
      FALKROSS_WEBSERVICE_PASSWORD: 'pass',
      FALKROSS_CUSTOMER_NUMBER: '12345'
    }).submitPurchaseOrder(payload);

    expect(result.submitted).toBe(true);
    expect(result.externalOrderId).toBe('WS-123');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://ws.falk-ross.eu/webservice/R02_000/order?format=xml');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
    expect(init.body).toContain('<customers_number><cn_value>12345</cn_value></customers_number>');
    expect(init.body).toContain('<order_note><on_value><![CDATA[Mitaller: revisar precios antes de confirmar. Camiseta 032.42 -> 2.73 EUR]]></on_value></order_note>');
    expect(init.body).toContain('<p_sku>180000002</p_sku>');
    expect(init.body).toContain('<pq_ordered>3</pq_ordered>');
  });

  it('sincroniza stock desde CSV Falk & Ross con Basic Auth', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'sku;stock\n180000002;7\n180000003;0\n'
    });
    vi.stubGlobal('fetch', fetchSpy);
    const upsert = vi.fn();
    const adapter = new SupplierAdapter(
      { supplierStock: { upsert } } as never,
      {
        get: (key: string) => ({
          FALKROSS_WEBSERVICE_USER: 'user',
          FALKROSS_WEBSERVICE_PASSWORD: 'pass'
        })[key]
      } as never
    );

    const result = await adapter.syncStock();

    expect(result.synced).toBe(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://ws.falk-ross.eu/webservice/R01_000/stockinfo/falkross_de.csv',
      expect.objectContaining({
        headers: { Authorization: `Basic ${Buffer.from('user:pass').toString('base64')}` }
      })
    );
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: '180000002' } },
      create: { supplier: 'FALK_ROSS', supplierSku: '180000002', availableQuantity: 7 }
    }));
  });

  it('importa catalogo CSV Falk & Ross con SKU largo, modelo, color y talla', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => [
        'p_sku;style_code;product_name;color;size;purchase_price',
        '180000002;TG002;B&C 032.42 T-shirt;White;M;2,73',
        '290000222;2000;102.09 Heavy T-Shirt;Brown;M;3.10'
      ].join('\n')
    });
    vi.stubGlobal('fetch', fetchSpy);
    const upsert = vi.fn();
    const adapter = new SupplierAdapter(
      { supplierArticle: { upsert } } as never,
      { get: (key: string) => ({ FALKROSS_ARTICLE_MASTER_URL: 'https://example.test/catalog.csv' })[key] } as never
    );

    const result = await adapter.importCatalog();

    expect(result.imported).toBe(2);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: '180000002' } },
      create: expect.objectContaining({
        supplierSku: '180000002',
        styleCode: 'TG002',
        productName: 'B&C 032.42 T-shirt',
        color: 'White',
        size: 'M',
        purchasePrice: '2.73'
      })
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: '290000222' } },
      create: expect.objectContaining({
        supplierSku: '290000222',
        styleCode: '2000',
        productName: '102.09 Heavy T-Shirt',
        color: 'Brown',
        size: 'M'
      })
    }));
  });
});
