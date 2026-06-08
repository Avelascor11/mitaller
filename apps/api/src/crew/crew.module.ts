import { Module } from '@nestjs/common';
import { KlaviyoModule } from '../klaviyo/klaviyo.module';
import { MetaModule } from '../meta/meta.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { CrewController } from './crew.controller';
import { CrewService } from './crew.service';
import { GoAffProAdapter } from './goaffpro.adapter';
import { GoogleDriveAdapter } from './google-drive.adapter';

@Module({
  imports: [PrismaModule, ShopifyModule, KlaviyoModule, MetaModule],
  controllers: [CrewController],
  providers: [CrewService, GoAffProAdapter, GoogleDriveAdapter],
  exports: [CrewService]
})
export class CrewModule {}
