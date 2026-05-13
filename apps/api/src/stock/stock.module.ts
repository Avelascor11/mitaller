import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { StockController } from './stock.controller';
import { StockReceiptsService } from './stock-receipts.service';
import { StockService } from './stock.service';

@Module({
  imports: [ActivityModule],
  controllers: [StockController],
  providers: [StockService, StockReceiptsService],
  exports: [StockService]
})
export class StockModule {}
