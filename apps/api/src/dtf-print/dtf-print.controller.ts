import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { DtfPrintService } from './dtf-print.service';

@Controller('dtf-print')
export class DtfPrintController {
  constructor(private readonly service: DtfPrintService) {}

  @Get('jobs')
  jobs() {
    return this.service.listJobs();
  }

  @Post('jobs/generate')
  generate() {
    return this.service.generateMissingDtfPrintJobs();
  }

  @Get('queue')
  queue(@Headers('x-print-agent-token') token?: string) {
    return this.service.claimQueue(token);
  }

  @Post('jobs/:id/mark-printed')
  markPrinted(@Param('id') id: string, @Headers('x-print-agent-token') token?: string, @Body() body?: { result?: unknown }) {
    return this.service.markPrinted(id, token, body?.result);
  }

  @Post('jobs/:id/mark-failed')
  markFailed(@Param('id') id: string, @Headers('x-print-agent-token') token?: string, @Body() body?: { error?: string; result?: unknown }) {
    return this.service.markFailed(id, token, body?.error ?? 'Fallo de impresion DTF', body?.result);
  }
}
