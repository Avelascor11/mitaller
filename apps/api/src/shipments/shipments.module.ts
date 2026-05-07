import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { SendcloudModule } from '../sendcloud/sendcloud.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { LabelPrinterService } from './label-printer.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [ActivityModule, SendcloudModule, ShopifyModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, LabelPrinterService]
})
export class ShipmentsModule {}
