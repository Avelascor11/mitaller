import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EconomicsController } from './economics.controller';
import { EconomicsService } from './economics.service';

@Module({
  imports: [PrismaModule],
  controllers: [EconomicsController],
  providers: [EconomicsService]
})
export class EconomicsModule {}
