import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { ShelfController } from './shelf.controller';
import { ShelfService } from './shelf.service';

@Module({
  imports: [PrismaModule, ShopifyModule],
  controllers: [ShelfController],
  providers: [ShelfService]
})
export class ShelfModule {}
