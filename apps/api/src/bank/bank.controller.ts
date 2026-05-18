import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BankService } from './bank.service';

@Controller('bank')
export class BankController {
  constructor(private readonly bank: BankService) {}

  @Get('status')
  status() {
    return this.bank.status();
  }

  @Get('institutions')
  institutions(@Query('country') country?: string) {
    return this.bank.institutions(country ?? 'ES');
  }

  @Post('connect')
  connect(@Body() body: { institutionId: string; institutionName?: string; redirectUrl?: string }) {
    return this.bank.connect(body);
  }

  @Get('callback')
  callback(@Query('ref') reference?: string, @Query('requisition_id') requisitionId?: string) {
    return this.bank.callback(reference, requisitionId);
  }

  @Post('sync')
  sync(@Body() body: { from?: string; to?: string } = {}) {
    return this.bank.sync(body.from, body.to);
  }

  @Get('transactions')
  transactions(@Query('from') from?: string, @Query('to') to?: string) {
    return this.bank.transactions(from, to);
  }

  @Get('daily')
  daily(@Query('from') from?: string, @Query('to') to?: string) {
    return this.bank.daily(from, to);
  }
}
