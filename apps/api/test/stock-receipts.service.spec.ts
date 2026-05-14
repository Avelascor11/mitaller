import { describe, expect, it } from 'vitest';
import { StockReceiptsService } from '../src/stock/stock-receipts.service';

describe('StockReceiptsService', () => {
  const stockItems = [
    { id: 'shirt-white-s', sku: 'BLANK-TS-WHT-S', supplierSku: 'FR-TS-WHT-S', name: 'Camiseta Blanca - S', type: 'BLANK_GARMENT' },
    { id: 'shirt-white-m', sku: 'BLANK-TS-WHT-M', supplierSku: 'FR-TS-WHT-M', name: 'Camiseta Blanca - M', type: 'BLANK_GARMENT' },
    { id: 'shirt-white-l', sku: 'BLANK-TS-WHT-L', supplierSku: 'FR-TS-WHT-L', name: 'Camiseta Blanca - L', type: 'BLANK_GARMENT' },
    { id: 'shirt-white-xl', sku: 'BLANK-TS-WHT-XL', supplierSku: 'FR-TS-WHT-XL', name: 'Camiseta Blanca - XL', type: 'BLANK_GARMENT' },
    { id: 'shirt-black-m', sku: 'BLANK-TS-BLK-M', supplierSku: 'FR-TS-BLK-M', name: 'Camiseta Negra - M', type: 'BLANK_GARMENT' },
    { id: 'shirt-black-l', sku: 'BLANK-TS-BLK-L', supplierSku: 'FR-TS-BLK-L', name: 'Camiseta Negra - L', type: 'BLANK_GARMENT' },
    { id: 'shirt-black-xl', sku: 'BLANK-TS-BLK-XL', supplierSku: 'FR-TS-BLK-XL', name: 'Camiseta Negra - XL', type: 'BLANK_GARMENT' },
    { id: 'shirt-black-xxl', sku: 'BLANK-TS-BLK-XXL', supplierSku: 'FR-TS-BLK-XXL', name: 'Camiseta Negra - XXL', type: 'BLANK_GARMENT' },
    { id: 'shirt-charcoal-m', sku: 'BLANK-TS-CHC-M', supplierSku: 'FR-TS-CHC-M', name: 'Camiseta Charcoal - M', type: 'BLANK_GARMENT' },
    { id: 'shirt-charcoal-l', sku: 'BLANK-TS-CHC-L', supplierSku: 'FR-TS-CHC-L', name: 'Camiseta Charcoal - L', type: 'BLANK_GARMENT' },
    { id: 'shirt-navy-m', sku: 'BLANK-TS-NVY-M', supplierSku: 'FR-TS-NVY-M', name: 'Camiseta Navy - M', type: 'BLANK_GARMENT' },
    { id: 'shirt-navy-l', sku: 'BLANK-TS-NVY-L', supplierSku: 'FR-TS-NVY-L', name: 'Camiseta Navy - L', type: 'BLANK_GARMENT' },
    { id: 'shirt-sand-s', sku: 'BLANK-TS-SND-S', supplierSku: 'FR-TS-SND-S', name: 'Camiseta Sand - S', type: 'BLANK_GARMENT' },
    { id: 'shirt-sand-m', sku: 'BLANK-TS-SND-M', supplierSku: 'FR-TS-SND-M', name: 'Camiseta Sand - M', type: 'BLANK_GARMENT' },
    { id: 'shirt-sand-l', sku: 'BLANK-TS-SND-L', supplierSku: 'FR-TS-SND-L', name: 'Camiseta Sand - L', type: 'BLANK_GARMENT' },
    { id: 'shirt-sand-xl', sku: 'BLANK-TS-SND-XL', supplierSku: 'FR-TS-SND-XL', name: 'Camiseta Sand - XL', type: 'BLANK_GARMENT' },
    { id: 'hoodie-white-m', sku: 'BLANK-HD-WHT-M', supplierSku: 'FR-HD-WHT-M', name: 'Sudadera Blanca - M', type: 'BLANK_GARMENT' },
    { id: 'hoodie-black-m', sku: 'BLANK-HD-BLK-M', supplierSku: 'FR-HD-BLK-M', name: 'Sudadera Negra - M', type: 'BLANK_GARMENT' },
    { id: 'hoodie-tangerine-m', sku: 'BLANK-HD-TNG-M', supplierSku: 'FR-HD-TNG-M', name: 'Sudadera Tangerine - M', type: 'BLANK_GARMENT' }
  ];

  function makeService(createdLines: Array<{ stockItemId?: string; quantity: number; matchedName?: string }>) {
    return new StockReceiptsService({
      stockItem: { findMany: async () => stockItems },
      stockReceipt: {
        create: async ({ data }: { data: { lines: { create: typeof createdLines } } }) => {
          createdLines.push(...data.lines.create);
          return { id: 'receipt-1', lines: data.lines.create };
        }
      }
    } as never);
  }

  it('interpreta albaranes Packzettel con descripcion y cantidad en lineas separadas', async () => {
    const createdLines: Array<{ stockItemId?: string; quantity: number; matchedName?: string }> = [];
    const service = makeService(createdLines);

    await service.scanReceipt({
      rawText: [
        'Nº Articulo',
        'Descripción',
        'Cantidad',
        '03242',
        'TG002 White M',
        '#E220 T-Shirt',
        '1',
        '03242',
        'TG002 White M',
        '#E220 T-Shirt',
        '5',
        '03242',
        'TG002 White L',
        '#E220 T-Shirt',
        '3',
        '03242',
        'TG002 Black M',
        '#E220 T-Shirt',
        '2',
        '03242',
        'TG002 Mastic XL',
        '#E220 T-Shirt',
        '1'
      ].join('\n')
    });

    expect(createdLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ stockItemId: 'shirt-white-m', quantity: 6 }),
      expect.objectContaining({ stockItemId: 'shirt-white-l', quantity: 3 }),
      expect.objectContaining({ stockItemId: 'shirt-black-m', quantity: 2 }),
      expect.objectContaining({ stockItemId: 'shirt-sand-xl', quantity: 1 })
    ]));
  });

  it('interpreta lineas Packzettel compactas del PDF real', async () => {
    const createdLines: Array<{ stockItemId?: string; quantity: number; matchedName?: string }> = [];
    const service = makeService(createdLines);

    await service.scanReceipt({
      rawText: [
        'N° Articulo Descripción Cantidad',
        '03242 TG002 White M 1',
        '#E220 T-Shirt',
        '03242 TG002 White M 5',
        '#E220 T-Shirt',
        '03242 TG002 White L 3',
        '#E220 T-Shirt',
        '03242 TG002 White XL 4',
        '#E220 T-Shirt',
        '03242 TG002 Black M 2',
        '#E220 T-Shirt',
        '03242 TG002 Black M 1',
        '#E220 T-Shirt',
        '03242 TG002 Black L 1',
        '#E220 T-Shirt',
        '03242 TG002 Black XL 2',
        '#E220 T-Shirt',
        '03242 TG002 Black 2XL 1',
        '#E220 T-Shirt',
        '03242 TG002 Dark Grey M 1',
        '#E220 T-Shirt',
        '03242 TG002 Dark Grey L 1',
        '#E220 T-Shirt',
        '03242 TG002 Navy M 3',
        '#E220 T-Shirt',
        '03242 TG002 Navy L 1',
        '#E220 T-Shirt',
        '03242 TG002 Mastic S 1',
        '#E220 T-Shirt',
        '03242 TG002 Mastic M 2',
        '#E220 T-Shirt',
        '03242 TG002 Mastic L 1',
        '#E220 T-Shirt',
        '03242 TG002 Mastic XL 1',
        '#E220 T-Shirt',
        '23742 WG005 White M 1',
        'ID.333 Hoodie',
        '23742 WG005 Black M 1',
        'ID.333 Hoodie',
        '23742 WG005 Orange M 1',
        'ID.333 Hoodie'
      ].join('\n')
    });

    expect(createdLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ stockItemId: 'shirt-white-m', quantity: 6 }),
      expect.objectContaining({ stockItemId: 'shirt-white-l', quantity: 3 }),
      expect.objectContaining({ stockItemId: 'shirt-white-xl', quantity: 4 }),
      expect.objectContaining({ stockItemId: 'shirt-black-m', quantity: 3 }),
      expect.objectContaining({ stockItemId: 'shirt-black-l', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'shirt-black-xl', quantity: 2 }),
      expect.objectContaining({ stockItemId: 'shirt-black-xxl', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'shirt-charcoal-m', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'shirt-charcoal-l', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'shirt-navy-m', quantity: 3 }),
      expect.objectContaining({ stockItemId: 'shirt-navy-l', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'shirt-sand-s', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'shirt-sand-m', quantity: 2 }),
      expect.objectContaining({ stockItemId: 'shirt-sand-l', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'shirt-sand-xl', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'hoodie-white-m', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'hoodie-black-m', quantity: 1 }),
      expect.objectContaining({ stockItemId: 'hoodie-tangerine-m', quantity: 1 })
    ]));
  });

  it('no usa codigos de producto como ID.333 como cantidad de sudadera', async () => {
    const createdLines: Array<{ stockItemId?: string; quantity: number; matchedName?: string }> = [];
    const service = makeService(createdLines);

    await service.scanReceipt({
      rawText: [
        '23742',
        'WG005 White M',
        '1',
        'ID.333 Hoodie'
      ].join('\n')
    });

    expect(createdLines).toEqual([
      expect.objectContaining({ stockItemId: 'hoodie-white-m', quantity: 1 })
    ]);
    expect(createdLines).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stockItemId: 'hoodie-white-m', quantity: 333 })
    ]));
  });
});
