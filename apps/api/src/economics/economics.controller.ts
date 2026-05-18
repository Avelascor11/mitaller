import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { EconomicsService } from './economics.service';

@Controller('economics')
export class EconomicsController {
  constructor(private readonly economics: EconomicsService) {}

  @Get('today')
  today() {
    return this.economics.today();
  }

  @Get('month')
  month(@Query('year') year?: string, @Query('month') month?: string) {
    const y = year ? Number(year) : undefined;
    const m = month ? Number(month) : undefined;
    return this.economics.month(y, m);
  }

  @Get('range')
  range(@Query('from') from?: string, @Query('to') to?: string) {
    return this.economics.range(from, to);
  }

  @Get('products')
  products() {
    return this.economics.productMargins();
  }

  @Get('cashflow')
  cashflow() {
    return this.economics.cashflow();
  }

  @Get('payouts')
  payouts() {
    return this.economics.payouts();
  }

  @Get('order/:id')
  async order(@Param('id') id: string) {
    const result = await this.economics.orderBreakdown(id);
    if (!result) throw new NotFoundException('Pedido no encontrado');
    return result;
  }
}
