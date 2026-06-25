import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EconomicsModule } from '../economics/economics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [PrismaModule, ConfigModule, EconomicsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService]
})
export class EmployeesModule {}
