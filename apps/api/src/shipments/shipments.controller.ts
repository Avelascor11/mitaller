import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ShipmentsService } from './shipments.service';

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post(':orderId/create-label')
  createLabel(@Param('orderId') orderId: string) {
    return this.shipments.createLabelForOrder(orderId);
  }

  @Post(':orderId/scan-label')
  scanLabel(@Param('orderId') orderId: string, @Body() body: { barcode?: string; photoBase64?: string }) {
    return this.shipments.confirmLabelScan(orderId, body.barcode, body.photoBase64);
  }

  @Post(':orderId/finalize-without-label')
  finalizeWithoutLabel(@Param('orderId') orderId: string) {
    return this.shipments.finalizeWithoutLabel(orderId);
  }

  @Post(':orderId/finalize-created-label')
  finalizeCreatedLabel(@Param('orderId') orderId: string) {
    return this.shipments.finalizeCreatedLabel(orderId);
  }

  @Post(':orderId/finalize-without-scan')
  finalizeWithoutScan(@Param('orderId') orderId: string) {
    return this.shipments.finalizeCreatedLabel(orderId);
  }

  @Post(':orderId/package-photo')
  packagePhoto(@Param('orderId') orderId: string, @Body() body: { photoBase64?: string }) {
    return this.shipments.savePackagePhoto(orderId, body.photoBase64 ?? '');
  }

  @Get(':id/package-photo')
  async getPackagePhoto(@Param('id') id: string, @Res() res: Response) {
    const photo = await this.shipments.getPackagePhoto(id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(photo);
  }

  @Get(':id/tracking')
  tracking(@Param('id') id: string) {
    return this.shipments.fetchTracking(id);
  }

  @Get('finalized')
  finalized() {
    return this.shipments.findFinalized();
  }

  @Get('finalized/daily')
  finalizedDaily(@Query('days') days?: string) {
    return this.shipments.finalizedDailySummary(days ? Number(days) : undefined);
  }

  @Get()
  findAll() {
    return this.shipments.findAll();
  }

  @Get('print-queue')
  printQueue(@Headers('x-print-agent-token') token?: string) {
    return this.shipments.findPrintQueue(token);
  }

  @Post(':id/mark-printed')
  markPrinted(@Param('id') id: string, @Headers('x-print-agent-token') token?: string, @Body() body?: { result?: unknown }) {
    return this.shipments.markPrinted(id, token, body?.result);
  }

  @Post(':id/reprint')
  reprint(@Param('id') id: string) {
    return this.shipments.requestReprint(id);
  }

  @Post('order/:orderId/reprint')
  reprintByOrder(@Param('orderId') orderId: string) {
    return this.shipments.requestReprintByOrder(orderId);
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
