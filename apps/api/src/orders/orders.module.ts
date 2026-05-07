import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { PriorityModule } from '../priority/priority.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { OrderTaskFactoryService } from './order-task-factory.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [ActivityModule, PriorityModule, ShopifyModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderTaskFactoryService],
  exports: [OrdersService, OrderTaskFactoryService]
})
export class OrdersModule {}
