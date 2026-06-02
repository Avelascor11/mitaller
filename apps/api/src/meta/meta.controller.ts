import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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

  @Post('campaigns')
  create(@Body() body: CreateCampaignDto) {
    return this.meta.createCampaign(body);
  }

  @Post('campaigns/:id/status')
  setStatus(@Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'PAUSED' }) {
    return this.meta.setCampaignStatus(id, body.status);
  }
}
