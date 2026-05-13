import { BadRequestException, Injectable } from '@nestjs/common';
import { StockItem, StockItemType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ScanReceiptInput {
  rawText?: string;
  photoBase64?: string;
  supplier?: string;
}

interface ConfirmReceiptLineInput {
  id?: string;
  stockItemId?: string;
  quantity?: number;
  detectedName?: string;
}

interface ParsedReceiptLine {
  key: string;
  rawLine: string;
  stockItem: StockItem;
  detectedName: string;
  quantity: number;
  confidence: number;
}

@Injectable()
export class StockReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async scanReceipt(input: ScanReceiptInput) {
    const rawText = input.rawText?.trim() ?? '';
    if (!rawText) throw new BadRequestException('No se ha detectado texto en el albaran.');

    const stockItems = await this.prisma.stockItem.findMany({
      where: { type: StockItemType.BLANK_GARMENT },
      orderBy: [{ name: 'asc' }]
    });
    const lines = this.parseLines(rawText, stockItems);
    const photo = this.decodePhoto(input.photoBase64);

    return this.prisma.stockReceipt.create({
      data: {
        supplier: input.supplier?.trim() || undefined,
        rawText,
        photo: photo ? Uint8Array.from(photo) : undefined,
        photoMimeType: photo ? 'image/jpeg' : undefined,
        lines: {
          create: lines.map((line) => ({
            stockItemId: line.stockItem?.id,
            detectedName: line.detectedName,
            matchedName: line.stockItem?.name,
            sku: line.stockItem?.sku,
            supplierSku: line.stockItem?.supplierSku,
            quantity: line.quantity,
            confidence: line.confidence,
            rawLine: line.rawLine
          }))
        }
      },
      include: { lines: { include: { stockItem: true }, orderBy: { createdAt: 'asc' } } }
    });
  }

  async confirmReceipt(id: string, lines: ConfirmReceiptLineInput[]) {
    const receipt = await this.prisma.stockReceipt.findUniqueOrThrow({
      where: { id },
      include: { lines: true }
    });
    if (receipt.status === 'CONFIRMED') throw new BadRequestException('Este albaran ya estaba confirmado.');

    const existingById = new Map(receipt.lines.map((line) => [line.id, line]));
    const cleanLines = lines
      .map((line) => {
        const existing = line.id ? existingById.get(line.id) : undefined;
        return {
          id: line.id,
          stockItemId: line.stockItemId ?? existing?.stockItemId ?? undefined,
          quantity: Number(line.quantity ?? existing?.quantity ?? 0),
          detectedName: line.detectedName ?? existing?.detectedName ?? 'Linea manual'
        };
      })
      .filter((line) => line.stockItemId && Number.isInteger(line.quantity) && line.quantity > 0);

    if (!cleanLines.length) throw new BadRequestException('No hay lineas validas para recibir stock.');

    const location = await this.prisma.stockLocation.findUniqueOrThrow({ where: { code: 'EST-A-01' } });
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const received = [];
      for (const line of cleanLines) {
        const stockItem = await tx.stockItem.findUniqueOrThrow({ where: { id: line.stockItemId! } });
        await tx.stockLevel.upsert({
          where: { stockItemId_locationId: { stockItemId: stockItem.id, locationId: location.id } },
          create: { stockItemId: stockItem.id, locationId: location.id, quantity: line.quantity },
          update: { quantity: { increment: line.quantity } }
        });
        await tx.stockMovement.create({
          data: {
            stockItemId: stockItem.id,
            toLocationId: location.id,
            quantity: line.quantity,
            reason: 'RECEPCION_ALBARAN'
          }
        });
        if (line.id) {
          await tx.stockReceiptLine.update({
            where: { id: line.id },
            data: {
              stockItemId: stockItem.id,
              matchedName: stockItem.name,
              sku: stockItem.sku,
              supplierSku: stockItem.supplierSku,
              quantity: line.quantity
            }
          });
        }
        received.push({ stockItemId: stockItem.id, sku: stockItem.sku, name: stockItem.name, quantity: line.quantity });
      }

      const updated = await tx.stockReceipt.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedAt: now },
        include: { lines: { include: { stockItem: true }, orderBy: { createdAt: 'asc' } } }
      });
      await tx.activityLog.create({
        data: {
          entityType: 'StockReceipt',
          entityId: id,
          action: 'STOCK_RECEIPT_CONFIRMED',
          message: `Albaran confirmado con ${received.reduce((sum, line) => sum + line.quantity, 0)} unidades`,
          metadataJson: { received }
        }
      });
      return updated;
    });
  }

  recent() {
    return this.prisma.stockReceipt.findMany({
      include: { lines: { include: { stockItem: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
  }

  private parseLines(rawText: string, stockItems: StockItem[]) {
    const candidates = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 4);
    const results: ParsedReceiptLine[] = [];

    for (const rawLine of candidates) {
      const quantity = this.extractQuantity(rawLine);
      if (!quantity) continue;
      const stockItem = this.matchStockItem(rawLine, stockItems);
      if (!stockItem) continue;
      const key = `${stockItem.id}:${quantity}:${this.normalize(rawLine)}`;
      if (results.some((line) => line.key === key)) continue;
      results.push({
        key,
        rawLine,
        stockItem,
        detectedName: stockItem.name,
        quantity,
        confidence: this.confidenceFor(rawLine, stockItem)
      });
    }

    return results.map(({ key: _key, ...line }) => line);
  }

  private extractQuantity(line: string) {
    const cleaned = line.replace(/\b\d+[,.]\d{2}\b/g, ' ');
    const matches = [...cleaned.matchAll(/\b([1-9]\d{0,2})\b/g)].map((match) => Number(match[1]));
    if (!matches.length) return 0;
    return matches[matches.length - 1];
  }

  private matchStockItem(line: string, stockItems: StockItem[]) {
    const normalizedLine = this.normalize(line);
    const direct = stockItems.find((item) =>
      normalizedLine.includes(this.normalize(item.name)) ||
      normalizedLine.includes(this.normalize(item.sku)) ||
      (item.supplierSku ? normalizedLine.includes(this.normalize(item.supplierSku)) : false)
    );
    if (direct) return direct;

    const kind = this.detectKind(normalizedLine);
    const color = this.detectColor(normalizedLine);
    const size = this.detectSize(normalizedLine);
    if (!kind || !color || !size) return undefined;

    return stockItems.find((item) =>
      this.normalize(item.name).includes(kind) &&
      this.normalize(item.name).includes(color) &&
      this.normalize(item.name).includes(size)
    );
  }

  private confidenceFor(line: string, item: StockItem) {
    const normalizedLine = this.normalize(line);
    if (normalizedLine.includes(this.normalize(item.name))) return 0.98;
    if (normalizedLine.includes(this.normalize(item.sku))) return 0.92;
    if (item.supplierSku && normalizedLine.includes(this.normalize(item.supplierSku))) return 0.92;
    return 0.72;
  }

  private detectKind(value: string) {
    if (value.includes('sudadera') || value.includes('hoodie')) return 'sudadera';
    if (value.includes('camiseta') || value.includes('shirt') || value.includes('tshirt')) return 'camiseta';
    return undefined;
  }

  private detectColor(value: string) {
    const colors = ['blanca', 'negra', 'sand', 'charcoal', 'tangerine', 'azul', 'marron', 'rosa', 'navy'];
    return colors.find((color) => value.includes(color) || value.includes(color.replace('a', 'o')));
  }

  private detectSize(value: string) {
    const match = value.match(/(?:^|\s|[-_/])(?:talla\s*)?(xxl|xl|l|m|s)(?:\s|$|[-_/])/i);
    return match?.[1]?.toLowerCase();
  }

  private normalize(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private decodePhoto(input?: string) {
    if (!input) return undefined;
    const stripped = input.replace(/^data:image\/[a-z]+;base64,/i, '');
    try {
      const buffer = Buffer.from(stripped, 'base64');
      return buffer.length > 200 ? buffer : undefined;
    } catch {
      return undefined;
    }
  }
}
