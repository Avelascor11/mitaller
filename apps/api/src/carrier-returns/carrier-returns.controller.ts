import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CarrierReturnsService } from './carrier-returns.service';

@Controller('carrier-returns')
export class CarrierReturnsController {
  constructor(private readonly service: CarrierReturnsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.list(status);
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Post()
  create(@Body() body: { orderNumber: string; reason?: any; notes?: string }) {
    return this.service.create(body);
  }

  @Post('by-tracking')
  byTracking(@Body() body: { tracking: string; reason?: any }) {
    return this.service.createFromTracking(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Post(':id/request-payment')
  requestPayment(@Param('id') id: string) {
    return this.service.requestPayment(id);
  }
}
