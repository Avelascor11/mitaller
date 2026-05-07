import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  imports: [ActivityModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService]
})
export class ProductionModule {}
