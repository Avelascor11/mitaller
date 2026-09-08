import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ShelfService } from './shelf.service';

@Controller('shelf')
export class ShelfController {
  constructor(private readonly shelf: ShelfService) {}

  @Get()
  list() {
    return this.shelf.list();
  }

  @Get('stats')
  stats() {
    return this.shelf.stats();
  }

  @Get('catalog')
  catalog() {
    return this.shelf.catalog();
  }

  @Get('fulfillable')
  fulfillable() {
    return this.shelf.fulfillable();
  }

  @Get('barcode-print-queue')
  barcodePrintQueue() {
    return this.shelf.barcodePrintQueue();
  }

  @Post('barcodes/request-print')
  requestBarcodePrint() {
    return this.shelf.requestBarcodePrint();
  }

  @Post('barcodes/mark-printed')
  markBarcodesPrinted(@Body() body: { ids?: string[] }) {
    return this.shelf.markBarcodesPrinted(body.ids ?? []);
  }

  @Post()
  add(@Body() body: any) {
    return this.shelf.addManual(body);
  }

  @Post('from-order-item')
  addFromOrderItem(@Body() body: { orderItemId: string; quantity?: number }) {
    return this.shelf.addFromOrderItem(body.orderItemId, body.quantity);
  }

  @Post('unique-product')
  createUniqueProduct(@Body() body: {
    sourceProductId: string;
    size: string;
    price: number;
    compareAtPrice?: number | null;
    condition?: string;
    notes?: string;
  }) {
    return this.shelf.createUniqueListing(body);
  }

  @Patch(':id')
  adjust(@Param('id') id: string, @Body() body: { quantity: number }) {
    return this.shelf.adjust(id, Number(body.quantity));
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shelf.remove(id);
  }
}
