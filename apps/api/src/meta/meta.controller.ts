import { Body, Controller, Get, Headers, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApplyMetaDailyPlanDto, ApplyMetaRecommendationDto, CreateCampaignDto, MetaService } from './meta.service';

/** Mobile app routes — no JWT (internal Railway URL), like mobile-returns. */
@Controller('meta')
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  @Get('spend/daily')
  dailySpend(@Query('date') date?: string) {
    return this.meta.dailySpend(date);
  }

  @Get('billing')
  billing() {
    return this.meta.billingStatus();
  }

  @Get('autopilot')
  autopilotPreview() {
    return this.meta.autopilotRun(false);
  }

  @Post('autopilot/run')
  autopilotRun(@Body() body?: { apply?: boolean }) {
    return this.meta.autopilotRun(Boolean(body?.apply));
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

  @Get('campaigns/:id')
  campaignDetail(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    return this.meta.campaignDetail(id, from ?? today, to ?? today);
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

  @Get('influencers/status')
  influencerConnectionStatus() {
    return this.meta.influencerConnectionStatus();
  }

  @Post('influencers/import-conversations')
  importInfluencerConversations(@Body() body: { limit?: number; includeWeak?: boolean }) {
    return this.meta.importInfluencerConversations(body);
  }

  @Post('campaigns')
  create(@Body() body: CreateCampaignDto) {
    return this.meta.createCampaign(body);
  }

  @Post('campaigns/:id/status')
  setStatus(@Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'PAUSED' }) {
    return this.meta.setCampaignStatus(id, body.status);
  }

  @Post('recommendations/apply')
  applyRecommendation(@Body() body: ApplyMetaRecommendationDto) {
    return this.meta.applyRecommendation(body);
  }

  @Post('recommendations/preview')
  previewRecommendation(@Body() body: ApplyMetaRecommendationDto) {
    return this.meta.previewRecommendation(body);
  }

  @Get('recommendations/history')
  recommendationHistory(@Query('limit') limit?: string) {
    return this.meta.recommendationHistory(Number(limit ?? 30));
  }

  @Get('learning')
  learning(@Query('from') from?: string, @Query('to') to?: string) {
    return this.meta.learning(from, to);
  }

  @Get('daily-plan')
  dailyPlan(@Query('from') from?: string, @Query('to') to?: string) {
    return this.meta.dailyPlan(from, to);
  }

  @Get('weekend-cash')
  weekendCash(@Query('from') from?: string, @Query('to') to?: string) {
    return this.meta.weekendCash(from, to);
  }

  @Post('daily-plan/apply')
  applyDailyPlan(@Body() body: ApplyMetaDailyPlanDto) {
    return this.meta.applyDailyPlan(body);
  }
}
