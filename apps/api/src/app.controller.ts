import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(private readonly config: ConfigService) {}

  @Get('health')
  health() {
    return {
      ok: true,
      service: 'mitaller-api',
      build: 'sendcloud-customs-v3',
      commit: this.config.get('RAILWAY_GIT_COMMIT_SHA') ?? this.config.get('GIT_COMMIT_SHA') ?? null,
      checkedAt: new Date().toISOString()
    };
  }
}
