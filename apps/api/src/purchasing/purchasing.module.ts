import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { PurchaseService } from './purchase.service';

@Module({
  controllers: [PurchasingController],
  providers: [PurchaseService],
  exports: [PurchaseService]
})
export class PurchasingModule {}
