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

  @Get('products')
  products() {
    return this.economics.productMargins();
  }

  @Get('order/:id')
  async order(@Param('id') id: string) {
    const result = await this.economics.orderBreakdown(id);
    if (!result) throw new NotFoundException('Pedido no encontrado');
    return result;
  }
}
