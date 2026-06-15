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
    const products = await this.shopify.crewCatalog();
    return products
      .filter((p: any) => p.category === 'PRENDA')
      .map((p: any) => ({
        id: p.id,
        title: p.title,
        imageUrl: p.imageUrl,
        sizes: p.sizes,
        variants: p.variants
      }));
  }

  list() {
    return this.prisma.returnShelfItem.findMany({ orderBy: [{ productTitle: 'asc' }, { size: 'asc' }] });
  }

  async stats() {
    const items = await this.prisma.returnShelfItem.findMany({ select: { quantity: true } });
    return { units: items.reduce((s, i) => s + i.quantity, 0), references: items.length };
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
