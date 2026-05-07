import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

interface ManualPrintEntry {
  id: string;
  filename: string;
  bytes: Buffer;
  createdAt: Date;
}

const MAX_ENTRIES = 50;
const MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6h

@Injectable()
export class ManualPrintService {
  private readonly queue = new Map<string, ManualPrintEntry>();

  constructor(private readonly config: ConfigService) {}

  enqueue(filename: string, pdfBase64: string): { id: string; filename: string; createdAt: Date } {
    if (!filename || !pdfBase64) {
      throw new BadRequestException('filename y pdfBase64 son obligatorios');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(pdfBase64, 'base64');
    } catch {
      throw new BadRequestException('pdfBase64 invalido');
    }
    if (!bytes.length) throw new BadRequestException('PDF vacio');
    if (!bytes.subarray(0, 4).toString('ascii').startsWith('%PDF')) {
      throw new BadRequestException('El archivo no parece un PDF (falta cabecera %PDF)');
    }

    this.evictExpired();
    if (this.queue.size >= MAX_ENTRIES) {
      const oldest = [...this.queue.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (oldest) this.queue.delete(oldest.id);
    }

    const entry: ManualPrintEntry = {
      id: randomUUID(),
      filename: filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'etiqueta.pdf',
      bytes,
      createdAt: new Date()
    };
    this.queue.set(entry.id, entry);
    return { id: entry.id, filename: entry.filename, createdAt: entry.createdAt };
  }

  list(token?: string): { id: string; filename: string; createdAt: Date }[] {
    this.assertAgentToken(token);
    this.evictExpired();
    return [...this.queue.values()]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((entry) => ({ id: entry.id, filename: entry.filename, createdAt: entry.createdAt }));
  }

  fetch(id: string, token?: string): ManualPrintEntry {
    this.assertAgentToken(token);
    const entry = this.queue.get(id);
    if (!entry) throw new NotFoundException('Etiqueta no encontrada o ya consumida');
    return entry;
  }

  done(id: string, token?: string): { ok: true; id: string } {
    this.assertAgentToken(token);
    if (!this.queue.delete(id)) throw new NotFoundException('Etiqueta no encontrada');
    return { ok: true, id };
  }

  private evictExpired() {
    const now = Date.now();
    for (const [id, entry] of this.queue) {
      if (now - entry.createdAt.getTime() > MAX_AGE_MS) this.queue.delete(id);
    }
  }

  private assertAgentToken(token?: string) {
    const configured = this.config.get<string>('PRINT_AGENT_TOKEN')?.trim();
    if (!configured) return;
    if (token !== configured) throw new UnauthorizedException('Print agent token invalido');
  }
}
