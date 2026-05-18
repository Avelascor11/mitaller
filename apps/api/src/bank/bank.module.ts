import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';
import { TinkBankAdapter } from './tink-bank.adapter';

@Module({
  imports: [PrismaModule],
  controllers: [BankController],
  providers: [BankService, TinkBankAdapter],
  exports: [BankService]
})
export class BankModule {}
