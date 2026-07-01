import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
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

  @Get('overview')
  overview(@Query('period') period?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.economics.overview(period, from, to);
  }

  @Get('products')
  products() {
    return this.economics.productMargins();
  }

  @Get('ads-health')
  adsHealth(@Query('from') from?: string, @Query('to') to?: string) {
    return this.economics.adsHealth(from, to);
  }

  @Get('growth-control')
  growthControl() {
    return this.economics.growthControl();
  }

  @Get('cashflow')
  cashflow() {
    return this.economics.cashflow();
  }

  @Get('preorders/retro-aston')
  retroAstonPlan() {
    return this.economics.retroAstonPlan();
  }

  @Post('preorders/retro-aston/milestones/:milestone/pay')
  markRetroAstonPayment(
    @Param('milestone') milestone: string,
    @Body() body: { amount?: number; paidAt?: string; notes?: string | null }
  ) {
    return this.economics.markRetroAstonPayment(Number(milestone), body);
  }

  @Delete('preorders/retro-aston/milestones/:milestone/pay')
  unmarkRetroAstonPayment(@Param('milestone') milestone: string) {
    return this.economics.unmarkRetroAstonPayment(Number(milestone));
  }

  @Get('fixed-expenses')
  fixedExpenses(@Query('period') period?: string) {
    return this.economics.fixedExpenses(period);
  }

  @Post('fixed-expenses')
  createFixedExpense(@Body() body: {
    name: string;
    category: string;
    amount: number;
    currency?: string;
    dueDay?: number | null;
    matcher?: string | null;
    notes?: string | null;
  }) {
    return this.economics.createFixedExpense(body);
  }

  @Patch('fixed-expenses/:id')
  updateFixedExpense(@Param('id') id: string, @Body() body: {
    name?: string;
    category?: string;
    amount?: number;
    currency?: string;
    dueDay?: number | null;
    active?: boolean;
    matcher?: string | null;
    notes?: string | null;
  }) {
    return this.economics.updateFixedExpense(id, body);
  }

  @Delete('fixed-expenses/:id')
  deleteFixedExpense(@Param('id') id: string) {
    return this.economics.deleteFixedExpense(id);
  }

  @Post('fixed-expenses/:id/pay')
  markFixedExpensePaid(@Param('id') id: string, @Body() body: { period?: string; amount?: number; paidAt?: string; notes?: string | null }) {
    return this.economics.markFixedExpensePaid(id, body);
  }

  @Delete('fixed-expenses/:id/pay')
  unmarkFixedExpensePaid(@Param('id') id: string, @Query('period') period?: string) {
    return this.economics.unmarkFixedExpensePaid(id, period);
  }

  @Post('cashflow/:payoutId/mark')
  markPayout(@Param('payoutId') payoutId: string) {
    return this.economics.markPayout(payoutId);
  }

  @Delete('cashflow/:payoutId/mark')
  unmarkPayout(@Param('payoutId') payoutId: string) {
    return this.economics.unmarkPayout(payoutId);
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
