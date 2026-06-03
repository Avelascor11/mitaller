import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';

@Module({
  imports: [PrismaModule],
  controllers: [InfluencersController],
  providers: [InfluencersService],
  exports: [InfluencersService]
})
export class InfluencersModule {}
