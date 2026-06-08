import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { CrewController } from './crew.controller';
import { CrewService } from './crew.service';

@Module({
  imports: [PrismaModule, ShopifyModule],
  controllers: [CrewController],
  providers: [CrewService],
  exports: [CrewService]
})
export class CrewModule {}
