import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';
import { GoCardlessBankAdapter } from './gocardless-bank.adapter';

@Module({
  imports: [PrismaModule],
  controllers: [BankController],
  providers: [BankService, GoCardlessBankAdapter],
  exports: [BankService]
})
export class BankModule {}
