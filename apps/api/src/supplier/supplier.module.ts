import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierAdapter } from './supplier.adapter';

@Module({
  controllers: [SupplierController],
  providers: [SupplierAdapter]
})
export class SupplierModule {}
