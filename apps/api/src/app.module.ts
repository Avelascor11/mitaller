import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ActivityModule } from './activity/activity.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { BankModule } from './bank/bank.module';
import { DtfPrintModule } from './dtf-print/dtf-print.module';
import { EconomicsModule } from './economics/economics.module';
import { ManualPrintModule } from './manual-print/manual-print.module';
import { MetaModule } from './meta/meta.module';
import { CarrierReturnsModule } from './carrier-returns/carrier-returns.module';
import { ShelfModule } from './shelf/shelf.module';
import { CrewModule } from './crew/crew.module';
import { InfluencersModule } from './influencers/influencers.module';
import { OrdersModule } from './orders/orders.module';
import { PortalConfigModule } from './portal-config/portal-config.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductionModule } from './production/production.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { RecipesModule } from './recipes/recipes.module';
import { ReturnsModule } from './returns/returns.module';
import { SendcloudModule } from './sendcloud/sendcloud.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { ShopifyModule } from './shopify/shopify.module';
import { SpeedwearAiModule } from './speedwear-ai/speedwear-ai.module';
import { StockModule } from './stock/stock.module';
import { SupplierModule } from './supplier/supplier.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ActivityModule,
    AuthModule,
    BankModule,
    DtfPrintModule,
    OrdersModule,
    ProductionModule,
    StockModule,
    PurchasingModule,
    SendcloudModule,
    ShipmentsModule,
    ShopifyModule,
    RecipesModule,
    ReturnsModule,
    SupplierModule,
    ManualPrintModule,
    EconomicsModule,
    MetaModule,
    InfluencersModule,
    CrewModule,
    CarrierReturnsModule,
    ShelfModule,
    PortalConfigModule,
    SpeedwearAiModule
  ],
  controllers: [AppController]
})
export class AppModule {}
