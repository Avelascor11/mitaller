import { Module } from '@nestjs/common';
import { MarketingModule } from '../marketing/marketing.module';
import { KlaviyoService } from './klaviyo.service';

@Module({
  imports: [MarketingModule],
  providers: [KlaviyoService],
  exports: [KlaviyoService]
})
export class KlaviyoModule {}
