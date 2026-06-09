import { Body, Controller, Get, Headers, NotFoundException, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  findAll() {
    return this.orders.findAll();
  }

  @Get('orders/pending-preparation')
  findPendingPreparation() {
    return this.orders.findPendingPreparation();
  }

  @Get('orders/:id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @Patch('orders/:id/mark-prepared')
  markPrepared(@Param('id') id: string, @Body() body?: { photoBase64?: string }) {
    return this.orders.markPrepared(id, body?.photoBase64);
  }

  @Patch('orders/:id/confirm-picking')
  confirmPicking(@Param('id') id: string) {
    return this.orders.confirmPicking(id);
  }

  @Patch('orders/:id/damaged-garment')
  markDamagedGarment(@Param('id') id: string, @Body() body: { stockItemId?: string; quantity?: number; reason?: string }) {
    return this.orders.markDamagedGarment(id, body);
  }

  @Get('orders/:id/package-photo')
  async getPackagePhoto(@Param('id') id: string, @Res() res: Response) {
    const photo = await this.orders.getPackagePhoto(id);
    if (!photo) throw new NotFoundException('Sin foto');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(photo);
  }

  @Patch('orders/:id/reopen-preparation')
  reopenPreparation(@Param('id') id: string) {
    return this.orders.reopenPreparation(id);
  }

  @Post('orders/import-shopify')
  importShopify() {
    return this.orders.importShopifyOrders();
  }

  @Post('orders/import-sheet-pending')
  importSheetPending(@Body() payload: { rows?: SheetPendingOrderRow[] }) {
    return this.orders.importSheetPendingOrders(payload.rows ?? []);
  }

  @Post('webhooks/shopify/orders-create')
  orderCreated(@Body() payload: unknown, @Headers('x-shopify-hmac-sha256') hmac: string | undefined, @Req() request: Request & { rawBody?: Buffer }) {
    return this.orders.handleShopifyOrderCreated(payload, hmac, request.rawBody);
  }

  @Post('webhooks/shopify/orders-updated')
  orderUpdated(@Body() payload: unknown, @Headers('x-shopify-hmac-sha256') hmac: string | undefined, @Req() request: Request & { rawBody?: Buffer }) {
    return this.orders.handleShopifyOrderUpdated(payload, hmac, request.rawBody);
  }
}

interface SheetPendingOrderRow {
  orderNumber: string;
  title: string;
  quantity?: number;
  shippingMethod?: string;
  orderedAt?: string;
  productType?: string;
  color?: string;
  size?: string;
  sku?: string;
  imageUrl?: string;
}
