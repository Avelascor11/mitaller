import { Module } from '@nestjs/common';
import { KlaviyoModule } from '../klaviyo/klaviyo.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { CrewController } from './crew.controller';
import { CrewService } from './crew.service';
import { GoAffProAdapter } from './goaffpro.adapter';

@Module({
  imports: [PrismaModule, ShopifyModule, KlaviyoModule],
  controllers: [CrewController],
  providers: [CrewService, GoAffProAdapter],
  exports: [CrewService]
})
export class CrewModule {}
