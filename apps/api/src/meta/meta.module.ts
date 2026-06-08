import { Module } from '@nestjs/common';
import { KlaviyoModule } from '../klaviyo/klaviyo.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';

@Module({
  imports: [PrismaModule, KlaviyoModule],
  controllers: [MetaController],
  providers: [MetaService],
  exports: [MetaService]
})
export class MetaModule {}
