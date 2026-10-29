import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MarketingService } from './marketing.service';
import { MarketingAdminGuard } from './marketing.guard';
import { MarketingController, MarketingPublicController, MarketingIntegrationController, MarketingThrottlerGuard } from './marketing.controller';
@Module({ imports: [AuthModule, PrismaModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])], providers: [MarketingService, MarketingAdminGuard, MarketingThrottlerGuard], controllers: [MarketingController, MarketingPublicController, MarketingIntegrationController], exports: [MarketingService] })
export class MarketingModule {}
