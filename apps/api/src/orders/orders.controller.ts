import { Body, Controller, Get, Headers, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
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
  markPrepared(@Param('id') id: string) {
    return this.orders.markPrepared(id);
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
