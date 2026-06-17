import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { CarrierReturnsModule } from '../carrier-returns/carrier-returns.module';
import { KlaviyoModule } from '../klaviyo/klaviyo.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SendcloudModule } from '../sendcloud/sendcloud.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { ReturnsConfigService } from './returns-config.service';
import { ReturnsExceptionsService } from './returns-exceptions.service';
import { MobileApiKeyGuard } from './mobile-api-key.guard';
import { ReturnsPresenceService } from './returns-presence.service';
import { MobileReturnsController } from './mobile-returns.controller';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [PrismaModule, SendcloudModule, ShopifyModule, ActivityModule, AuthModule, KlaviyoModule, OrdersModule, CarrierReturnsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }])],
  controllers: [ReturnsController, MobileReturnsController],
  providers: [ReturnsService, ReturnsConfigService, ReturnsExceptionsService, MobileApiKeyGuard, ReturnsPresenceService],
  exports: [ReturnsService, ReturnsConfigService, ReturnsExceptionsService]
})
export class ReturnsModule {}
