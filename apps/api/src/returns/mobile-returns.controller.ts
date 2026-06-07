import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MobileApiKeyGuard } from './mobile-api-key.guard';
import { ReturnsService } from './returns.service';

/** Mobile app routes — protected by a shared X-API-Key (MOBILE_API_KEY). */
@Controller('mobile-returns')
@UseGuards(MobileApiKeyGuard)
export class MobileReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get()
  list() {
    return this.returnsService.findAll();
  }

  @Get('by-tracking/:tracking')
  findByTracking(@Param('tracking') tracking: string) {
    return this.returnsService.findByTracking(tracking);
  }

  @Post(':id/received')
  markReceived(@Param('id') id: string) {
    return this.returnsService.markReceived(id);
  }

  @Post(':id/verify')
  verify(
    @Param('id') id: string,
    @Body() body: { verificationStatus: 'OK' | 'ISSUE'; verificationNotes?: string }
  ) {
    return this.returnsService.verifyReturn(id, body);
  }
}
