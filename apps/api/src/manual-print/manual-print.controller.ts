import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ManualPrintService } from './manual-print.service';

@Controller('manual-print')
export class ManualPrintController {
  constructor(private readonly service: ManualPrintService) {}

  @Post()
  enqueue(@Body() body: { filename?: string; pdfBase64?: string }) {
    return this.service.enqueue(body?.filename ?? '', body?.pdfBase64 ?? '');
  }

  @Get('queue')
  list(@Headers('x-print-agent-token') token?: string) {
    return this.service.list(token);
  }

  @Get(':id/file')
  file(@Param('id') id: string, @Res() res: Response, @Headers('x-print-agent-token') token?: string) {
    const entry = this.service.fetch(id, token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
    res.send(entry.bytes);
  }

  @Post(':id/done')
  done(@Param('id') id: string, @Headers('x-print-agent-token') token?: string) {
    return this.service.done(id, token);
  }
}
