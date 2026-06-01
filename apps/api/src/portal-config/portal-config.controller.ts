import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PortalConfigService } from './portal-config.service';

@Controller('portal-config')
export class PortalConfigController {
  constructor(private readonly portalConfigService: PortalConfigService) {}

  @Get()
  getConfig() {
    return this.portalConfigService.getConfig();
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  updateConfig(
    @Body()
    body: {
      logoUrl?: string;
      faviconUrl?: string;
      backgroundUrl?: string;
      primaryColor?: string;
      cardStyle?: string;
      titleText?: string;
      subtitleText?: string;
      policyUrl?: string;
    },
  ) {
    return this.portalConfigService.updateConfig(body);
  }
}
