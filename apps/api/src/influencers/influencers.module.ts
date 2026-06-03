import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InfluencersCompatController, InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';

@Module({
  imports: [PrismaModule],
  controllers: [InfluencersController, InfluencersCompatController],
  providers: [InfluencersService],
  exports: [InfluencersService]
})
export class InfluencersModule {}
