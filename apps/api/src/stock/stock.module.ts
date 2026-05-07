import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Module({
  imports: [ActivityModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService]
})
export class StockModule {}
