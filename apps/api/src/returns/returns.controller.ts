import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ShopifyAdapter } from '../shopify/shopify.adapter';
import { CreateReturnDto } from './dto/create-return.dto';
import { LookupOrderDto } from './dto/lookup-order.dto';
import { ReturnsConfigService } from './returns-config.service';
import { ReturnsExceptionsService } from './returns-exceptions.service';
import { ReturnsService } from './returns.service';

@Controller('returns')
export class ReturnsController {
  constructor(
    private readonly returnsService: ReturnsService,
    private readonly shopify: ShopifyAdapter,
    private readonly configService: ReturnsConfigService,
    private readonly exceptionsService: ReturnsExceptionsService
  ) {}

  // ============ ADMIN: Config ============
  @Get('admin/config')
  @UseGuards(JwtAuthGuard)
  getConfig() {
    return this.configService.get();
  }

  @Put('admin/config')
  @UseGuards(JwtAuthGuard)
  updateConfig(@Body() body: Partial<{ windowDays: number; labelPrice: number; shippingProductCode: string; exchangePolicy: 'ANY' | 'SAME_TYPE' | 'VARIANT_ONLY'; termsText: string; enabled: boolean }>) {
    return this.configService.update(body);
  }

  // ============ ADMIN: Exceptions ============
  @Get('admin/exceptions')
  @UseGuards(JwtAuthGuard)
  listExceptions() {
    return this.exceptionsService.findAll();
  }

  @Post('admin/exceptions')
  @UseGuards(JwtAuthGuard)
  createException(@Body() body: { orderNumber?: string; customerEmail?: string; type: string; extraDays?: number; notes?: string; expiresAt?: string }) {
    return this.exceptionsService.create(body);
  }

  @Patch('admin/exceptions/:id')
  @UseGuards(JwtAuthGuard)
  updateException(@Param('id') id: string, @Body() body: { active?: boolean; notes?: string; extraDays?: number; expiresAt?: string | null }) {
    return this.exceptionsService.update(id, body);
  }

  @Delete('admin/exceptions/:id')
  @UseGuards(JwtAuthGuard)
  deleteException(@Param('id') id: string) {
    return this.exceptionsService.remove(id);
  }

  /** Public — customer looks up their order */
  @Post('lookup')
  lookup(@Body() dto: LookupOrderDto) {
    return this.returnsService.lookupOrder(dto);
  }

  /** Public — Shopify product catalog for exchange picker */
  @Get('catalog')
  catalog() {
    return this.shopify.getProductCatalog();
  }

  /** Public — customer creates return/exchange request */
  @Post()
  create(@Body() dto: CreateReturnDto) {
    return this.returnsService.createReturn(dto);
  }

  /** Public — check return status (polled by frontend after Shopify checkout) */
  @Get(':id/status')
  status(@Param('id') id: string) {
    return this.returnsService.getReturnStatus(id);
  }

  /** Public — download return label PDF (no auth, ID is opaque cuid) */
  @Get(':id/label')
  @Header('Content-Type', 'application/pdf')
  async downloadLabel(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.returnsService.downloadLabel(id);
    res.setHeader('Content-Disposition', `inline; filename="etiqueta-devolucion-${id}.pdf"`);
    res.send(buffer);
  }

  /** Shopify webhook — order paid (draft order completed) */
  @Post('webhooks/order-paid')
  async orderPaid(@Body() payload: { id?: string | number; tags?: string; source_name?: string; source_identifier?: string | number; note?: string }) {
    const tags = (payload.tags ?? '').toString().toLowerCase();
    const isReturnPortal = tags.includes('return-portal') || (payload.source_name === 'shopify_draft_order' && (payload.note ?? '').toLowerCase().includes('devolución pedido'));

    if (!isReturnPortal) {
      return { received: true, ignored: true, reason: 'not a return-portal order' };
    }

    // Prefer source_identifier → GID; fallback → extract order number from note
    let identifier: { type: 'draftOrderId'; value: string } | { type: 'orderNumber'; value: string } | null = null;

    if (payload.source_identifier) {
      identifier = { type: 'draftOrderId', value: `gid://shopify/DraftOrder/${payload.source_identifier}` };
    } else if (payload.note) {
      const match = (payload.note as string).match(/pedido\s+(#?\d+)/i);
      if (match) identifier = { type: 'orderNumber', value: match[1] };
    }

    if (!identifier) {
      console.log('[Webhook order-paid] cannot identify return — note:', payload.note);
      return { received: true, ignored: true, reason: 'cannot identify return' };
    }

    console.log('[Webhook order-paid] processing', identifier);
    const updated = await this.returnsService.markPaidAndGenerateLabel(identifier);
    return { received: true, processed: !!updated, returnId: updated?.id };
  }

  /** Admin — list all returns */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.returnsService.findAll();
  }

  /** iOS app — list returns (no JWT, internal use) */
  @Get('admin/list')
  findAllAlias() {
    return this.returnsService.findAll();
  }

  /** iOS app — find return by tracking number */
  @Get('admin/by-tracking/:tracking')
  findByTracking(@Param('tracking') tracking: string) {
    return this.returnsService.findByTracking(tracking);
  }

  /** iOS app — mark received */
  @Post(':id/received')
  markReceivedPost(@Param('id') id: string) {
    return this.returnsService.markReceived(id);
  }

  /** iOS app — verify */
  @Post(':id/verify')
  verifyReturnPost(
    @Param('id') id: string,
    @Body() body: { verificationStatus: 'OK' | 'ISSUE'; verificationNotes?: string }
  ) {
    return this.returnsService.verifyReturn(id, body);
  }

  /** Admin — get return detail */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.returnsService.findOne(id);
  }

  /** Admin — update return status */
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.returnsService.updateStatus(id, status);
  }

  /** Admin — manually generate label + send email */
  @Post(':id/generate-label')
  @UseGuards(JwtAuthGuard)
  generateLabel(@Param('id') id: string) {
    return this.returnsService.generateLabelForReturn(id);
  }

  /** Admin — mark package as received */
  @Patch(':id/received')
  @UseGuards(JwtAuthGuard)
  markReceived(@Param('id') id: string) {
    return this.returnsService.markReceived(id);
  }

  /** Admin — verify received package */
  @Patch(':id/verify')
  @UseGuards(JwtAuthGuard)
  verifyReturn(
    @Param('id') id: string,
    @Body() body: { verificationStatus: 'OK' | 'ISSUE'; verificationNotes?: string }
  ) {
    return this.returnsService.verifyReturn(id, body);
  }

  /** Admin — upload photo evidence */
  @Post(':id/photos')
  @UseGuards(JwtAuthGuard)
  uploadPhoto(@Param('id') id: string, @Body('data') data: string) {
    return this.returnsService.uploadPhoto(id, data);
  }

  /** Admin — get photos for a return */
  @Get(':id/photos')
  @UseGuards(JwtAuthGuard)
  getPhotos(@Param('id') id: string) {
    return this.returnsService.getPhotos(id);
  }
}
