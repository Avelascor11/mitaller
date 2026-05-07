import { Body, Controller, Get, Post } from '@nestjs/common';
import { SupplierAdapter } from './supplier.adapter';

@Controller('supplier')
export class SupplierController {
  constructor(private readonly supplier: SupplierAdapter) {}

  @Get('articles')
  articles() {
    return this.supplier.listArticles();
  }

  @Get('stock')
  stock() {
    return this.supplier.listStock();
  }

  @Post('import-catalog')
  importCatalog(@Body() body: { sourcePath?: string }) {
    return this.supplier.importCatalog(body.sourcePath);
  }

  @Post('sync-stock')
  syncStock() {
    return this.supplier.syncStock();
  }
}
