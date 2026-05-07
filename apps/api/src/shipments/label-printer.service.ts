import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class LabelPrinterService {
  private readonly logger = new Logger(LabelPrinterService.name);

  constructor(private readonly config: ConfigService) {}

  async printLabel(labelUrl?: string | null, orderNumber?: string) {
    if (!this.autoPrintEnabled) {
      return { skipped: true, reason: 'AUTO_PRINT_LABELS disabled' };
    }
    const printerName = this.config.get<string>('LABEL_PRINTER_NAME')?.trim();
    if (!printerName) {
      return { skipped: true, reason: 'LABEL_PRINTER_NAME missing' };
    }
    if (!labelUrl) {
      return { skipped: true, reason: 'label URL missing' };
    }

    const labelFile = await this.downloadLabel(labelUrl, orderNumber);
    const args = [
      '-d',
      printerName,
      '-o',
      'fit-to-page',
      '-o',
      `media=${this.paperSize}`,
      labelFile
    ];

    try {
      const result = await execFileAsync('lp', args);
      return {
        skipped: false,
        printerName,
        paperSize: this.paperSize,
        labelFile,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
      };
    } catch (error) {
      this.logger.error(`No se pudo imprimir la etiqueta ${orderNumber ?? ''}`, error instanceof Error ? error.stack : undefined);
      return {
        skipped: false,
        printerName,
        paperSize: this.paperSize,
        labelFile,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async downloadLabel(labelUrl: string, orderNumber?: string) {
    const response = await fetch(labelUrl, { headers: this.labelDownloadHeaders(labelUrl) });
    if (!response.ok) {
      throw new Error(`No se pudo descargar la etiqueta: HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const dir = await mkdtemp(join(tmpdir(), 'mitaller-label-'));
    const cleanOrderNumber = (orderNumber ?? 'pedido').replace(/[^a-zA-Z0-9_-]/g, '');
    const file = join(dir, `${cleanOrderNumber || 'pedido'}-sendcloud-label.pdf`);
    await writeFile(file, bytes);
    return file;
  }

  private get autoPrintEnabled() {
    return String(this.config.get('AUTO_PRINT_LABELS') ?? 'false').toLowerCase() === 'true';
  }

  private get paperSize() {
    return this.config.get<string>('LABEL_PAPER_SIZE')?.trim() || 'Custom.100x150mm';
  }

  private labelDownloadHeaders(labelUrl: string): HeadersInit {
    const publicKey = this.config.get<string>('SENDCLOUD_PUBLIC_KEY') ?? '';
    const secretKey = this.config.get<string>('SENDCLOUD_SECRET_KEY') ?? '';
    if (!labelUrl.includes('sendcloud') || !publicKey || !secretKey) return {};
    return {
      Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`
    };
  }
}
