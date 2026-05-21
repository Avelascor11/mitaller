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
  async orderPaid(@Body() payload: { id?: string | number; admin_graphql_api_id?: string; tags?: string; source_name?: string; source_identifier?: string | number }) {
    // Detect draft order id from either source_identifier or by looking at tags
    const tags = (payload.tags ?? '').toString().toLowerCase();
    if (!tags.includes('return-portal')) {
      return { received: true, ignored: true, reason: 'not a return-portal order' };
    }
    const draftOrderId = payload.source_identifier ? `gid://shopify/DraftOrder/${payload.source_identifier}` : null;
    if (!draftOrderId) {
      return { received: true, ignored: true, reason: 'no source_identifier' };
    }
    const updated = await this.returnsService.markPaidAndGenerateLabel(draftOrderId);
    return { received: true, processed: !!updated, returnId: updated?.id };
  }

  /** Admin — list all returns */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.returnsService.findAll();
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
}
