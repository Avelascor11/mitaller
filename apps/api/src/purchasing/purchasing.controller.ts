import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PurchaseService } from './purchase.service';

@Controller('purchase-needs')
export class PurchasingController {
  constructor(private readonly purchase: PurchaseService) {}

  @Get('today')
  today() {
    return this.purchase.getTodayNeeds();
  }

  @Get('matrix')
  matrix() {
    return this.purchase.getPurchaseMatrix();
  }

  @Post('generate')
  generate() {
    return this.purchase.generateDailyPurchaseNeeds();
  }

  @Get('fulfillable')
  fulfillable() {
    return this.purchase.getFulfillableOrders();
  }

  @Get('order/:orderId/picking-list')
  orderPickingList(@Param('orderId') orderId: string) {
    return this.purchase.getOrderPickingList(orderId);
  }

  @Post('import-product-mappings')
  importProductMappings(@Body() body: { mappings?: ProductSubproductMappingInput[] }) {
    return this.purchase.importProductMappings(body.mappings ?? []);
  }

  @Get('product-mappings')
  productMappings() {
    return this.purchase.getProductMappings();
  }

  @Get('mapping-workbench')
  mappingWorkbench() {
    return this.purchase.getMappingWorkbench();
  }

  @Post('product-mappings')
  saveProductMapping(@Body() body: ProductSubproductMappingInput) {
    return this.purchase.saveProductMapping(body);
  }
}

interface ProductSubproductMappingInput {
  productName: string;
  productType?: string;
  color?: string;
  size?: string;
  sku?: string;
  subproductName: string;
  imageRef?: string;
}
