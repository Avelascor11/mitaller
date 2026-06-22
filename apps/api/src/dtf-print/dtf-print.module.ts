import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { DtfPrintController } from './dtf-print.controller';
import { DtfPrintService } from './dtf-print.service';

@Module({
  imports: [ActivityModule, PurchasingModule],
  controllers: [DtfPrintController],
  providers: [DtfPrintService],
  exports: [DtfPrintService]
})
export class DtfPrintModule {}
