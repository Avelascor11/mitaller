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
      where: { type: { in: [StockItemType.BLANK_GARMENT, StockItemType.TRANSFER] } },
      orderBy: [{ name: 'asc' }]
    });
    const lines = this.parseLines(rawText, this.receiptableStockItems(stockItems));
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
        if (!this.isReceiptableStockItem(stockItem)) {
          throw new BadRequestException(`El albaran solo puede recibir camisetas y sudaderas. Revisa ${stockItem.name}.`);
        }
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
    const sourceLines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 1);
    const results = new Map<string, ParsedReceiptLine>();

    for (let index = 0; index < sourceLines.length; index += 1) {
      if (this.isReceiptNoiseLine(sourceLines[index])) continue;

      const packzettelLine = this.parsePackzettelLine(sourceLines[index], stockItems);
      if (packzettelLine) {
        this.addParsedResult(results, packzettelLine);
        continue;
      }

      const parsed = this.parseReceiptBlock(sourceLines, index, stockItems);
      if (!parsed) continue;
      index += parsed.consumedLines - 1;
      this.addParsedResult(results, parsed);
    }

    return [...results.values()].map(({ key: _key, ...line }) => line);
  }

  private isReceiptNoiseLine(line: string) {
    const normalized = this.normalize(line);
    return normalized.includes('articulo descripcion cantidad') ||
      normalized === 'n articulo' ||
      normalized === 'descripcion' ||
      normalized === 'cantidad' ||
      normalized === 'e220 t shirt' ||
      normalized === 'id 333 hoodie';
  }

  private addParsedResult(
    results: Map<string, ParsedReceiptLine>,
    parsed: { rawLine: string; stockItem: StockItem; quantity: number; confidence?: number }
  ) {
    const { rawLine, stockItem, quantity } = parsed;
    const key = stockItem.id;
    const existing = results.get(key);
    results.set(key, {
      key,
      rawLine: existing ? `${existing.rawLine}\n${rawLine}` : rawLine,
      stockItem,
      detectedName: stockItem.name,
      quantity: (existing?.quantity ?? 0) + quantity,
      confidence: Math.max(existing?.confidence ?? 0, parsed.confidence ?? this.confidenceFor(rawLine, stockItem))
    });
  }

  private parsePackzettelLine(line: string, stockItems: StockItem[]) {
    const match = line.match(/^\d{4,}\s+(TG002|WG005)\s+(.+?)\s+(2XL|XXL|XL|L|M|S)\s+([1-9]\d{0,2})$/i);
    if (!match) return null;

    const [, code, colorText, sizeText, quantityText] = match;
    const kind = code.toUpperCase() === 'WG005' ? 'sudadera' : 'camiseta';
    const color = this.detectColor(this.normalize(colorText));
    const size = this.normalizeSize(sizeText);
    const quantity = Number(quantityText);
    if (!color || !size || !quantity) return null;

    const stockItem = this.findByKindColorSize(stockItems, kind, color, size);
    if (!stockItem) return null;

    return { rawLine: line, stockItem, quantity, consumedLines: 1, confidence: 0.96 };
  }

  private parseReceiptBlock(lines: string[], start: number, stockItems: StockItem[]) {
    for (let length = 1; length <= 5; length += 1) {
      const block = lines
        .slice(start, start + length)
        .filter((line) => !this.isReceiptNoiseLine(line));
      if (!block.length) continue;
      const rawLine = block.join(' ');
      const quantity = this.extractQuantity(rawLine);
      if (!quantity) continue;
      const stockItem = this.matchStockItem(rawLine, stockItems);
      if (!stockItem) continue;
      return { rawLine, stockItem, quantity, consumedLines: length };
    }
    return null;
  }

  private extractQuantity(line: string) {
    const cleaned = line.replace(/\b\d+[,.]\d{2}\b/g, ' ');
    const end = cleaned.match(/\b([1-9]\d{0,2})\s*$/);
    if (end) return Number(end[1]);
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

    return this.findByKindColorSize(stockItems, kind, color, size);
  }

  private findByKindColorSize(stockItems: StockItem[], kind: string, color: string, size: string) {
    return stockItems.find((item) => {
      const normalizedName = this.normalize(item.name);
      const tokens = normalizedName.split(/\s+/);
      return normalizedName.includes(kind) &&
        normalizedName.includes(color) &&
        tokens.includes(size);
    });
  }

  private confidenceFor(line: string, item: StockItem) {
    const normalizedLine = this.normalize(line);
    if (normalizedLine.includes(this.normalize(item.name))) return 0.98;
    if (normalizedLine.includes(this.normalize(item.sku))) return 0.92;
    if (item.supplierSku && normalizedLine.includes(this.normalize(item.supplierSku))) return 0.92;
    return 0.72;
  }

  private detectKind(value: string) {
    if (value.includes('banador') || value.includes('swim') || value.includes('bikini')) return 'banador';
    if (value.includes('sudadera') || value.includes('hoodie') || /\bwg005\b/.test(value)) return 'sudadera';
    if (value.includes('camiseta') || value.includes('shirt') || value.includes('tshirt') || value.includes('t shirt') || /\btg002\b/.test(value)) return 'camiseta';
    return undefined;
  }

  private receiptableStockItems(stockItems: StockItem[]) {
    return stockItems.filter((item) => this.isReceiptableStockItem(item));
  }

  private isReceiptableStockItem(stockItem: Pick<StockItem, 'name' | 'sku' | 'supplierSku'>) {
    const text = this.normalize(`${stockItem.name} ${stockItem.sku} ${stockItem.supplierSku ?? ''}`);
    if (text.includes('banador') || text.includes('swim') || text.includes('bikini')) return false;
    return text.includes('camiseta') || text.includes('sudadera') || /\btg002\b/.test(text) || /\bwg005\b/.test(text);
  }

  private detectColor(value: string) {
    const colors: Array<[string, RegExp]> = [
      ['blanca', /\b(blanca|blanco|white)\b/],
      ['negra', /\b(negra|negro|black)\b/],
      ['sand', /\b(sand|arena|mastic)\b/],
      ['charcoal', /\b(charcoal|dark grey|dark gray|gris)\b/],
      ['tangerine', /\b(tangerine|naranja|orange)\b/],
      ['azul', /\b(azul|blue)\b/],
      ['marron', /\b(marron|brown)\b/],
      ['rosa', /\b(rosa|pink)\b/],
      ['navy', /\b(navy|marino)\b/]
    ];
    return colors.find(([, pattern]) => pattern.test(value))?.[0];
  }

  private detectSize(value: string) {
    const match = value.match(/(?:^|\s|[-_/])(?:talla\s*)?(2xl|xxl|xl|l|m|s)(?:\s|$|[-_/])/i);
    if (!match) return undefined;
    return this.normalizeSize(match[1]);
  }

  private normalizeSize(value: string) {
    return value.toLowerCase() === '2xl' ? 'xxl' : value.toLowerCase();
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
