import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SendcloudModule } from '../sendcloud/sendcloud.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { ReturnsConfigService } from './returns-config.service';
import { ReturnsExceptionsService } from './returns-exceptions.service';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [PrismaModule, SendcloudModule, ShopifyModule, ActivityModule, AuthModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnsConfigService, ReturnsExceptionsService],
  exports: [ReturnsService, ReturnsConfigService, ReturnsExceptionsService]
})
export class ReturnsModule {}
