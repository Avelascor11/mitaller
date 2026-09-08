import { describe, expect, it, vi } from 'vitest';
import { ShelfService } from '../src/shelf/shelf.service';

describe('ShelfService unique Shopify products', () => {
  it('creates an individual listing with a valid barcode and stock record', async () => {
    const prisma = {
      returnShelfItem: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'shelf-1', ...data }))
      }
    };
    const shopify = {
      createUniqueShelfProduct: vi.fn().mockImplementation((input) => Promise.resolve({
        productId: 'gid://shopify/Product/10',
        variantId: 'gid://shopify/ProductVariant/11',
        sourceTitle: 'Camiseta Nano Inmortal',
        title: 'ARCHIVO | Camiseta Nano Inmortal | M',
        handle: 'archivo-nano-m',
        sku: input.sku,
        barcode: input.barcode,
        price: input.price,
        compareAtPrice: 29.95,
        imageUrl: 'https://cdn.test/nano.jpg',
        adminUrl: 'https://speedwear.es/admin/products/10'
      }))
    };
    const service = new ShelfService(prisma as never, shopify as never);

    const response = await service.createUniqueListing({
      sourceProductId: 'gid://shopify/Product/1',
      size: 'M',
      price: 15,
      compareAtPrice: 29.95,
      condition: 'Como nueva'
    });

    expect(response.shopify.barcode).toMatch(/^29\d{11}$/);
    expect(validEan13(response.shopify.barcode)).toBe(true);
    expect(shopify.createUniqueShelfProduct).toHaveBeenCalledWith(expect.objectContaining({
      sourceProductId: 'gid://shopify/Product/1',
      size: 'M',
      price: 15,
      sku: `SW-ARCH-${response.shopify.barcode}`
    }));
    expect(prisma.returnShelfItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopifyProductId: 'gid://shopify/Product/10',
        quantity: 1,
        source: 'SHOPIFY_UNIQUE',
        salePrice: 15,
        barcode: response.shopify.barcode
      })
    });
  });

  it('queues every unprinted barcode and serves batches of eight', async () => {
    const prisma = {
      returnShelfItem: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'one' }, { id: 'two' }])
          .mockResolvedValueOnce(Array.from({ length: 8 }, (_, index) => ({ id: `item-${index}`, barcode: `29000000000${index}` }))),
        updateMany: vi.fn().mockResolvedValue({ count: 2 })
      }
    };
    const service = new ShelfService(prisma as never, {} as never);

    await expect(service.requestBarcodePrint()).resolves.toEqual({ requested: 2 });
    await service.barcodePrintQueue();

    expect(prisma.returnShelfItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['one', 'two'] } }
    }));
    expect(prisma.returnShelfItem.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 8 }));
  });
});

function validEan13(value: string) {
  const digits = value.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return check === (10 - sum % 10) % 10;
}
