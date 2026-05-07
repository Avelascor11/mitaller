import { Module } from '@nestjs/common';
import { SendcloudAdapter } from './sendcloud.adapter';

@Module({
  providers: [SendcloudAdapter],
  exports: [SendcloudAdapter]
})
export class SendcloudModule {}
