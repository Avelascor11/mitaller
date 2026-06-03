import { Body, Controller, Get, Headers, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CreateCampaignDto, MetaService } from './meta.service';

/** Mobile app routes — no JWT (internal Railway URL), like mobile-returns. */
@Controller('meta')
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  @Get('spend/daily')
  dailySpend(@Query('date') date?: string) {
    return this.meta.dailySpend(date);
  }

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.meta.summary(from, to);
  }

  @Get('campaigns')
  campaigns(@Query('from') from?: string, @Query('to') to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    return this.meta.campaigns(from ?? today, to ?? today);
  }

  @Get('templates')
  templates() {
    return this.meta.campaignTemplates();
  }

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string
  ) {
    if (!this.meta.verifyWebhookChallenge(mode, token)) {
      throw new UnauthorizedException('Meta webhook no autorizado');
    }
    return challenge ?? '';
  }

  @Post('webhook')
  handleWebhook(
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: Request & { rawBody?: Buffer }
  ) {
    return this.meta.handleInstagramWebhook(body, signature, request.rawBody);
  }

  @Post('influencers/import-conversations')
  importInfluencerConversations(@Body() body: { limit?: number }) {
    return this.meta.importInfluencerConversations(body?.limit);
  }

  @Post('campaigns')
  create(@Body() body: CreateCampaignDto) {
    return this.meta.createCampaign(body);
  }

  @Post('campaigns/:id/status')
  setStatus(@Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'PAUSED' }) {
    return this.meta.setCampaignStatus(id, body.status);
  }
}
