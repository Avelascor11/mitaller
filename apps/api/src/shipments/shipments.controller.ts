import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post(':orderId/create-label')
  createLabel(@Param('orderId') orderId: string) {
    return this.shipments.createLabelForOrder(orderId);
  }

  @Post(':orderId/scan-label')
  scanLabel(@Param('orderId') orderId: string, @Body() body: { barcode?: string }) {
    return this.shipments.confirmLabelScan(orderId, body.barcode);
  }

  @Get()
  findAll() {
    return this.shipments.findAll();
  }

  @Get('shipping-methods')
  shippingMethods() {
    return this.shipments.listShippingMethods();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shipments.findOne(id);
  }
}
