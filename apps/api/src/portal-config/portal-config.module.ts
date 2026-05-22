import { Module } from '@nestjs/common';
import { PortalConfigController } from './portal-config.controller';
import { PortalConfigService } from './portal-config.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PortalConfigController],
  providers: [PortalConfigService],
})
export class PortalConfigModule {}
