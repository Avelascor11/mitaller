import { Controller, Get, Post } from '@nestjs/common';
import { PurchaseService } from './purchase.service';

@Controller('purchase-needs')
export class PurchasingController {
  constructor(private readonly purchase: PurchaseService) {}

  @Get('today')
  today() {
    return this.purchase.getTodayNeeds();
  }

  @Get('matrix')
  matrix() {
    return this.purchase.getPurchaseMatrix();
  }

  @Post('generate')
  generate() {
    return this.purchase.generateDailyPurchaseNeeds();
  }
}
