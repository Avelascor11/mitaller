import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShelfController } from './shelf.controller';
import { ShelfService } from './shelf.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShelfController],
  providers: [ShelfService]
})
export class ShelfModule {}
