import { Module } from '@nestjs/common';
import { MetaModule } from '../meta/meta.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { EconomicsController } from './economics.controller';
import { EconomicsService } from './economics.service';

@Module({
  imports: [PrismaModule, ShopifyModule, MetaModule],
  controllers: [EconomicsController],
  providers: [EconomicsService]
})
export class EconomicsModule {}
