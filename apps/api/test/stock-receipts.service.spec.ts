import { describe, expect, it } from 'vitest';
import { StockReceiptsService } from '../src/stock/stock-receipts.service';

describe('StockReceiptsService', () => {
  it('interpreta albaranes Packzettel con descripcion y cantidad en lineas separadas', async () => {
    const createdLines: Array<{ stockItemId?: string; quantity: number; matchedName?: string }> = [];
    const service = new StockReceiptsService({
      stockItem: {
        findMany: async () => [
          { id: 'white-m', sku: 'BLANK-TS-WHT-M', supplierSku: 'FR-TS-WHT-M', name: 'Camiseta Blanca - M', type: 'BLANK_GARMENT' },
          { id: 'white-l', sku: 'BLANK-TS-WHT-L', supplierSku: 'FR-TS-WHT-L', name: 'Camiseta Blanca - L', type: 'BLANK_GARMENT' },
          { id: 'black-m', sku: 'BLANK-TS-BLK-M', supplierSku: 'FR-TS-BLK-M', name: 'Camiseta Negra - M', type: 'BLANK_GARMENT' },
          { id: 'sand-xl', sku: 'BLANK-TS-SND-XL', supplierSku: 'FR-TS-SND-XL', name: 'Camiseta Sand - XL', type: 'BLANK_GARMENT' }
        ]
      },
      stockReceipt: {
        create: async ({ data }: { data: { lines: { create: typeof createdLines } } }) => {
          createdLines.push(...data.lines.create);
          return { id: 'receipt-1', lines: data.lines.create };
        }
      }
    } as never);

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
      expect.objectContaining({ stockItemId: 'white-m', quantity: 6 }),
      expect.objectContaining({ stockItemId: 'white-l', quantity: 3 }),
      expect.objectContaining({ stockItemId: 'black-m', quantity: 2 }),
      expect.objectContaining({ stockItemId: 'sand-xl', quantity: 1 })
    ]));
  });
});
