import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
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
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const adapter = new SupplierAdapter(
      { supplierStock: { deleteMany, createMany } } as never,
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
    expect(deleteMany).toHaveBeenCalledWith({ where: { supplier: 'FALK_ROSS' } });
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ supplier: 'FALK_ROSS', supplierSku: '180000002', availableQuantity: 7 }),
        expect.objectContaining({ supplier: 'FALK_ROSS', supplierSku: '180000003', availableQuantity: 0 })
      ]),
      skipDuplicates: true
    }));
  });

  it('sincroniza stock R03 sin cabecera separando Espana, Alemania y proveedor', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '2026-06-02 21:52:17\n110331217;4;35;250\n765542007;0;9;40\n'
    });
    vi.stubGlobal('fetch', fetchSpy);
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const adapter = new SupplierAdapter(
      { supplierStock: { deleteMany, createMany } } as never,
      {
        get: (key: string) => ({
          FALKROSS_WEBSERVICE_USER: 'user',
          FALKROSS_WEBSERVICE_PASSWORD: 'pass',
          FALKROSS_STOCK_CSV_URL: 'https://example.test/r03.csv'
        })[key]
      } as never
    );

    const result = await adapter.syncStock();

    expect(result.synced).toBe(2);
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({
          supplierSku: '110331217',
          availableQuantity: 39,
          stockSpain24h: 4,
          stockCentral3To5Days: 35,
          stockSupplier5To20Days: 250
        }),
        expect.objectContaining({
          supplierSku: '765542007',
          availableQuantity: 9,
          stockSpain24h: 0,
          stockCentral3To5Days: 9,
          stockSupplier5To20Days: 40
        })
      ])
    }));
  });

  it('importa catalogo CSV Falk & Ross con SKU largo, modelo, color y talla', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from([
        'p_sku;style_code;product_name;color;size;purchase_price',
        '180000002;TG002;B&C 032.42 T-shirt;White;M;2,73',
        '290000222;2000;102.09 Heavy T-Shirt;Brown;M;3.10'
      ].join('\n'))
    });
    vi.stubGlobal('fetch', fetchSpy);
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const adapter = new SupplierAdapter(
      { supplierArticle: { deleteMany, createMany } } as never,
      { get: (key: string) => ({ FALKROSS_ARTICLE_MASTER_URL: 'https://example.test/catalog.csv' })[key] } as never
    );

    const result = await adapter.importCatalog();

    expect(result.imported).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { supplier: 'FALK_ROSS' } });
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({
        supplierSku: '180000002',
        styleCode: 'TG002',
        productName: 'B&C 032.42 T-shirt',
        color: 'White',
        size: 'M',
        purchasePrice: '2.73'
        }),
        expect.objectContaining({
        supplierSku: '290000222',
        styleCode: '2000',
        productName: '102.09 Heavy T-Shirt',
        color: 'Brown',
        size: 'M'
        })
      ]),
      skipDuplicates: true
    }));
  });

  it('importa catalogo XLSX ArticleMasterData de Falk & Ross', async () => {
    const workbook = XLSX.utils.book_new();
    const rows = [
      ['article data list Falk&Ross Group Europe GmbH', null, null, null, 'date from: 7.4.2025'],
      ['article number short', 'article number long', 'Style', 'supplier_code', 'supplier_name', 'size_code', 'size_name', 'color_code', 'color_name', 'supplier_article_name', 'article_name', 'customer_price /1-2/', 'Pieces_in_Pack'],
      ['032.42', '032420002', '032', '42', 'B & C', '2', 'M', '000', 'White', 'TG002', 'E150 T-Shirt', '2.73', '10'],
      ['102.09', '102090003', '102', '09', 'FalkRoss', '3', 'L', '123', 'Brown', '2000', 'Heavy T-Shirt', '3.10', '5']
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'article');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer
    });
    vi.stubGlobal('fetch', fetchSpy);
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const adapter = new SupplierAdapter(
      { supplierArticle: { deleteMany, createMany } } as never,
      { get: (key: string) => ({ FALKROSS_ARTICLE_MASTER_URL: 'https://example.test/master.xlsx' })[key] } as never
    );

    const result = await adapter.importCatalog();

    expect(result.imported).toBe(2);
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({
          supplierSku: '032420002',
          styleCode: '032.42',
          productName: 'TG002 - E150 T-Shirt',
          color: 'White',
          size: 'M',
          purchasePrice: '2.73',
          packQuantity: 10
        }),
        expect.objectContaining({
          supplierSku: '102090003',
          styleCode: '102.09',
          color: 'Brown',
          size: 'L'
        })
      ])
    }));
  });
});
