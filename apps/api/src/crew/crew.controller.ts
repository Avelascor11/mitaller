import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CrewApplyBody, CrewService } from './crew.service';

/** Public crew recruitment form endpoints — no auth. */
@Controller('crew')
export class CrewController {
  constructor(private readonly crew: CrewService) {}

  @Get('tier')
  tier(@Query('followers') followers?: string) {
    return this.crew.tierFor(Number(followers ?? 0));
  }

  @Get('catalog')
  catalog() {
    return this.crew.catalog();
  }

  @Post('apply')
  apply(@Body() body: CrewApplyBody) {
    return this.crew.apply(body);
  }

  @Post('collaborations/:id/approve')
  approve(@Param('id') id: string) {
    return this.crew.approve(id);
  }

  @Get('collaborations/:id/performance')
  performance(@Param('id') id: string) {
    return this.crew.affiliatePerformance(id);
  }
}
