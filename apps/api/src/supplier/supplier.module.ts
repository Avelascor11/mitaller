import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SupplierController } from './supplier.controller';
import { SupplierAdapter } from './supplier.adapter';
import { SupplierOrderService } from './supplier-order.service';

@Module({
  imports: [ActivityModule, PurchasingModule],
  controllers: [SupplierController],
  providers: [SupplierAdapter, SupplierOrderService],
  exports: [SupplierAdapter, SupplierOrderService]
})
export class SupplierModule {}
