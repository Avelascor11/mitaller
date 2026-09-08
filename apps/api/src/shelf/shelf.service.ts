import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyAdapter } from '../shopify/shopify.adapter';

const PENDING_STATUSES: OperationalStatus[] = [
  OperationalStatus.NEW,
  OperationalStatus.WAITING_STOCK,
  OperationalStatus.WAITING_PRODUCTION,
  OperationalStatus.IN_PRODUCTION,
  OperationalStatus.PRODUCED,
  OperationalStatus.WAITING_PICKING,
  OperationalStatus.PICKED,
  OperationalStatus.BLOCKED
];

function normSize(s?: string | null): string {
  return (s ?? '').toString().trim().toUpperCase().replace('2XL', 'XXL');
}
function normTitle(s?: string | null): string {
  return (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

@Injectable()
export class ShelfService {
  constructor(private readonly prisma: PrismaService, private readonly shopify: ShopifyAdapter) {}

  /** All brand garments (camisetas + sudaderas + bañadores) to pick from when stocking the shelf. */
  async catalog() {
    if (!this.shopify.hasCredentials()) return [];
    return this.shopify.shelfRecognitionCatalog();
  }

  /** Publish one physical archive garment as an individual Shopify product with stock one. */
  async createUniqueListing(input: {
    sourceProductId: string;
    size: string;
    price: number;
    compareAtPrice?: number | null;
    condition?: string;
    notes?: string;
  }) {
    const sourceProductId = input.sourceProductId?.trim();
    const size = normSize(input.size);
    const price = Number(input.price);
    if (!sourceProductId) throw new BadRequestException('Producto original requerido');
    if (!size) throw new BadRequestException('Talla requerida');
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('El precio debe ser mayor que cero');

    const barcode = await this.createUniqueBarcode();
    const sku = `SW-ARCH-${barcode}`;
    const condition = input.condition?.trim() || 'Como nueva';
    const shopify = await this.shopify.createUniqueShelfProduct({
      sourceProductId,
      size,
      price,
      compareAtPrice: input.compareAtPrice,
      condition,
      notes: input.notes?.trim() || null,
      sku,
      barcode
    });

    const shelfItem = await this.prisma.returnShelfItem.create({
      data: {
        productTitle: shopify.sourceTitle,
        sourceShopifyProductId: sourceProductId,
        shopifyProductId: shopify.productId,
        shopifyVariantId: shopify.variantId,
        sku,
        barcode,
        size,
        imageUrl: shopify.imageUrl,
        salePrice: price,
        quantity: 1,
        source: 'SHOPIFY_UNIQUE',
        notes: [condition, input.notes?.trim()].filter(Boolean).join(' · '),
        listedAt: new Date()
      }
    });
    return { shelfItem, shopify };
  }

  private async createUniqueBarcode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const time = Date.now().toString().slice(-8);
      const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
      const body = `29${time}${random}`;
      const weighted = body.split('').reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
      const barcode = `${body}${(10 - weighted % 10) % 10}`;
      const existing = await this.prisma.returnShelfItem.findFirst({ where: { barcode } });
      if (!existing) return barcode;
    }
    throw new BadRequestException('No se pudo generar un código único. Inténtalo de nuevo.');
  }

  list() {
    return this.prisma.returnShelfItem.findMany({ orderBy: [{ productTitle: 'asc' }, { size: 'asc' }] });
  }

  async stats() {
    const items = await this.prisma.returnShelfItem.findMany({ select: { quantity: true, barcode: true, barcodePrintedAt: true } });
    return {
      units: items.reduce((s, i) => s + i.quantity, 0),
      references: items.length,
      pendingBarcodes: items.filter((item) => item.barcode && !item.barcodePrintedAt).length
    };
  }

  async requestBarcodePrint() {
    const pending = await this.prisma.returnShelfItem.findMany({
      where: { barcode: { not: null }, barcodePrintedAt: null },
      select: { id: true }
    });
    if (!pending.length) return { requested: 0 };
    await this.prisma.returnShelfItem.updateMany({
      where: { id: { in: pending.map((item) => item.id) } },
      data: { barcodePrintRequestedAt: new Date() }
    });
    return { requested: pending.length };
  }

  barcodePrintQueue() {
    return this.prisma.returnShelfItem.findMany({
      where: {
        barcode: { not: null },
        barcodePrintRequestedAt: { not: null },
        barcodePrintedAt: null
      },
      select: { id: true, productTitle: true, size: true, salePrice: true, sku: true, barcode: true },
      orderBy: { barcodePrintRequestedAt: 'asc' },
      take: 8
    });
  }

  async markBarcodesPrinted(ids: string[]) {
    const cleanIds = [...new Set((ids ?? []).filter(Boolean))];
    if (!cleanIds.length) throw new BadRequestException('No hay etiquetas para marcar');
    const result = await this.prisma.returnShelfItem.updateMany({
      where: { id: { in: cleanIds }, barcodePrintRequestedAt: { not: null } },
      data: { barcodePrintedAt: new Date() }
    });
    return { ok: true, printed: result.count };
  }

  /** Manual add: a printed garment on the returns shelf. */
  async addManual(input: { productTitle: string; sku?: string; shopifyProductId?: string; shopifyVariantId?: string; color?: string; size: string; imageUrl?: string; quantity?: number; notes?: string }) {
    const productTitle = input.productTitle?.trim();
    const size = normSize(input.size);
    if (!productTitle) throw new BadRequestException('Producto requerido');
    if (!size) throw new BadRequestException('Talla requerida');
    const qty = Number.isInteger(input.quantity) && input.quantity! > 0 ? input.quantity! : 1;

    // Merge into existing same variant/product+size to avoid duplicate rows.
    const existing = await this.prisma.returnShelfItem.findFirst({
      where: input.shopifyVariantId
        ? { shopifyVariantId: input.shopifyVariantId }
        : { productTitle, size, color: input.color?.trim() || null }
    });
    if (existing) {
      return this.prisma.returnShelfItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + qty } });
    }
    return this.prisma.returnShelfItem.create({
      data: {
        productTitle, size,
        sku: input.sku?.trim() || null,
        shopifyProductId: input.shopifyProductId || null,
        shopifyVariantId: input.shopifyVariantId || null,
        color: input.color?.trim() || null,
        imageUrl: input.imageUrl || null,
        quantity: qty,
        source: 'MANUAL',
        notes: input.notes?.trim() || null
      }
    });
  }

  /** Add to shelf from an existing order line (pulls product/design + size). */
  async addFromOrderItem(orderItemId: string, quantity?: number) {
    const item = await this.prisma.orderItem.findUnique({ where: { id: orderItemId } });
    if (!item) throw new NotFoundException('Artículo de pedido no encontrado');
    return this.addManual({
      productTitle: item.title,
      sku: item.sku,
      shopifyProductId: item.shopifyProductId ?? undefined,
      shopifyVariantId: item.shopifyVariantId ?? undefined,
      color: item.color ?? undefined,
      size: item.size ?? '',
      imageUrl: item.imageUrl ?? undefined,
      quantity
    });
  }

  async adjust(id: string, quantity: number) {
    const item = await this.prisma.returnShelfItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('No encontrado');
    if (quantity <= 0) {
      await this.prisma.returnShelfItem.delete({ where: { id } });
      return { ok: true, deleted: true };
    }
    return this.prisma.returnShelfItem.update({ where: { id }, data: { quantity } });
  }

  async remove(id: string) {
    await this.prisma.returnShelfItem.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  /** Match shelf stock against pending orders: which orders can be (fully/partly) covered from the shelf. */
  async fulfillable() {
    const [shelf, orders] = await Promise.all([
      this.prisma.returnShelfItem.findMany({ where: { quantity: { gt: 0 } } }),
      this.prisma.order.findMany({
        where: { operationalStatus: { in: PENDING_STATUSES } },
        include: { items: { where: { status: { not: 'CANCELLED' } } } },
        orderBy: { orderedAt: 'asc' }
      })
    ]);

    // available pool keyed by variantId and by productId|size and by sku|size
    const pool = shelf.map((s) => ({ ...s, remaining: s.quantity }));
    const matchShelf = (it: { shopifyVariantId?: string | null; shopifyProductId?: string | null; sku?: string | null; size?: string | null; title?: string | null }) => {
      const size = normSize(it.size);
      const title = normTitle(it.title);
      return pool.find((s) => s.remaining > 0 && (
        (it.shopifyVariantId && s.shopifyVariantId && s.shopifyVariantId === it.shopifyVariantId) ||
        (it.shopifyProductId && s.shopifyProductId && s.shopifyProductId === it.shopifyProductId && normSize(s.size) === size) ||
        (it.sku && s.sku && s.sku === it.sku && normSize(s.size) === size) ||
        (title && normTitle(s.productTitle) === title && normSize(s.size) === size)
      ));
    };

    const result: any[] = [];
    for (const order of orders) {
      const lines: any[] = [];
      let matchedUnits = 0, totalUnits = 0;
      for (const it of order.items) {
        totalUnits += it.quantity;
        let need = it.quantity;
        let fromShelf = 0;
        // allocate greedily from matching shelf entries
        let shelfMatch = matchShelf(it);
        while (need > 0 && shelfMatch) {
          const take = Math.min(need, shelfMatch.remaining);
          shelfMatch.remaining -= take;
          fromShelf += take;
          need -= take;
          shelfMatch = matchShelf(it);
        }
        matchedUnits += fromShelf;
        lines.push({
          orderItemId: it.id, title: it.title, size: it.size, sku: it.sku,
          quantity: it.quantity, fromShelf, imageUrl: it.imageUrl
        });
      }
      if (matchedUnits > 0) {
        result.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          operationalStatus: order.operationalStatus,
          totalUnits,
          matchedUnits,
          fulfillability: matchedUnits >= totalUnits ? 'FULL' : 'PARTIAL',
          lines
        });
      }
    }
    // full first, then most-matched
    result.sort((a, b) => (a.fulfillability === 'FULL' ? -1 : 1) - (b.fulfillability === 'FULL' ? -1 : 1) || b.matchedUnits - a.matchedUnits);
    return { shelfUnits: pool.reduce((s, x) => s + x.quantity, 0), orders: result };
  }
}
