import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  findAll() {
    return this.stock.findAll();
  }

  @Get('locations')
  locations() {
    return this.stock.locations();
  }

  @Get(':sku')
  getStockBySku(@Param('sku') sku: string) {
    return this.stock.getStockBySku(sku);
  }

  @Post('move')
  move(@Body() body: { stockItemId: string; fromLocationId?: string; toLocationId?: string; quantity: number; reason: string; userId?: string }) {
    return this.stock.moveStock(body);
  }

  @Patch(':sku/quantity')
  setQuantity(@Param('sku') sku: string, @Body() body: { quantity: number }) {
    return this.stock.setStockQuantityBySku(sku, body.quantity);
  }
}
