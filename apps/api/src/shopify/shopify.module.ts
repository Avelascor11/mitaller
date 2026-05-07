import { Module } from '@nestjs/common';
import { ShopifyAdapter } from './shopify.adapter';

@Module({
  providers: [ShopifyAdapter],
  exports: [ShopifyAdapter]
})
export class ShopifyModule {}
