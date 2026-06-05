import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SupplierAdapter } from './supplier.adapter';
import { SupplierOrderService } from './supplier-order.service';

@Controller('supplier')
export class SupplierController {
  constructor(
    private readonly supplier: SupplierAdapter,
    private readonly supplierOrders: SupplierOrderService
  ) {}

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

  @Get('purchase-orders')
  purchaseOrders() {
    return this.supplierOrders.listPurchaseOrders();
  }

  @Get('purchase-orders/:id')
  purchaseOrder(@Param('id') id: string) {
    return this.supplierOrders.getPurchaseOrder(id);
  }

  @Get('purchase-orders/:id/proof')
  purchaseOrderProof(@Param('id') id: string) {
    return this.supplierOrders.getPurchaseOrderProof(id);
  }

  @Post('purchase-orders/daily')
  generateDailyPurchaseOrder(@Body() body: { submit?: boolean }) {
    return this.supplierOrders.generateDailyFalkRossOrder({ submit: Boolean(body.submit), source: 'manual' });
  }

  @Post('purchase-orders/:id/submit')
  submitPurchaseOrder(@Param('id') id: string) {
    return this.supplierOrders.submitPurchaseOrder(id);
  }
}
