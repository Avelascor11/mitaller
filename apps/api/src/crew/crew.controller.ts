import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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
}
