import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';
import { MetaModule } from '../meta/meta.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { EconomicsController } from './economics.controller';
import { EconomicsService } from './economics.service';

@Module({
  imports: [PrismaModule, ShopifyModule, MetaModule, BankModule, PurchasingModule],
  controllers: [EconomicsController],
  providers: [EconomicsService],
  exports: [EconomicsService]
})
export class EconomicsModule {}
