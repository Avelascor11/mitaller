import { Module } from '@nestjs/common';
import { ManualPrintController } from './manual-print.controller';
import { ManualPrintService } from './manual-print.service';

@Module({
  controllers: [ManualPrintController],
  providers: [ManualPrintService]
})
export class ManualPrintModule {}
