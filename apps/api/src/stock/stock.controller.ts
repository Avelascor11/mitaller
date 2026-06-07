import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { StockReceiptsService } from './stock-receipts.service';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService, private readonly receipts: StockReceiptsService) {}

  @Get()
  findAll() {
    return this.stock.findAll();
  }

  @Get('locations')
  locations() {
    return this.stock.locations();
  }

  @Get('receipts/recent')
  recentReceipts() {
    return this.receipts.recent();
  }

  @Post('receipts/scan')
  scanReceipt(@Body() body: { rawText?: string; photoBase64?: string; supplier?: string }) {
    return this.receipts.scanReceipt(body);
  }

  @Post('receipts/:id/confirm')
  confirmReceipt(@Param('id') id: string, @Body() body: { lines?: Array<{ id?: string; stockItemId?: string; quantity?: number; detectedName?: string }> }) {
    return this.receipts.confirmReceipt(id, body.lines ?? []);
  }

  @Post('items')
  createItem(@Body() body: { name: string; sku?: string; color?: string; size?: string; minStock?: number; barcode?: string; supplierSku?: string }) {
    return this.stock.createItem(body);
  }

  @Get(':sku')
  getStockBySku(@Param('sku') sku: string) {
    return this.stock.getStockBySku(sku);
  }

  @Patch(':sku')
  updateItem(@Param('sku') sku: string, @Body() body: { minStock?: number; name?: string; color?: string; size?: string; supplierSku?: string; barcode?: string }) {
    return this.stock.updateItem(sku, body);
  }

  @Delete(':sku')
  deleteItem(@Param('sku') sku: string) {
    return this.stock.deleteItem(sku);
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
