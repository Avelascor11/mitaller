import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ActivityModule } from './activity/activity.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ManualPrintModule } from './manual-print/manual-print.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductionModule } from './production/production.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { RecipesModule } from './recipes/recipes.module';
import { SendcloudModule } from './sendcloud/sendcloud.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { ShopifyModule } from './shopify/shopify.module';
import { StockModule } from './stock/stock.module';
import { SupplierModule } from './supplier/supplier.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ActivityModule,
    AuthModule,
    OrdersModule,
    ProductionModule,
    StockModule,
    PurchasingModule,
    SendcloudModule,
    ShipmentsModule,
    ShopifyModule,
    RecipesModule,
    SupplierModule,
    ManualPrintModule
  ],
  controllers: [AppController]
})
export class AppModule {}
