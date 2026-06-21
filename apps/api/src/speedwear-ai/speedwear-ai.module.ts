import { Module } from '@nestjs/common';
import { MetaModule } from '../meta/meta.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SpeedwearAiController } from './speedwear-ai.controller';
import { SpeedwearAiService } from './speedwear-ai.service';

@Module({
  imports: [PrismaModule, MetaModule],
  controllers: [SpeedwearAiController],
  providers: [SpeedwearAiService]
})
export class SpeedwearAiModule {}
