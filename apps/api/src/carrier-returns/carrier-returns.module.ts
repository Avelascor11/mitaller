import { Module } from '@nestjs/common';
import { KlaviyoModule } from '../klaviyo/klaviyo.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { CarrierReturnsController } from './carrier-returns.controller';
import { CarrierReturnsService } from './carrier-returns.service';

@Module({
  imports: [PrismaModule, ShopifyModule, KlaviyoModule],
  controllers: [CarrierReturnsController],
  providers: [CarrierReturnsService],
  exports: [CarrierReturnsService]
})
export class CarrierReturnsModule {}
