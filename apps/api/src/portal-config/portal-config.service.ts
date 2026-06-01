import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PortalConfigService {
  constructor(private prisma: PrismaService) {}

  async getConfig() {
    let config = await this.prisma.portalConfig.findUnique({ where: { id: 'singleton' } });
    if (!config) {
      config = await this.prisma.portalConfig.create({
        data: { id: 'singleton' },
      });
    }
    return config;
  }

  async updateConfig(data: {
    logoUrl?: string;
    faviconUrl?: string;
    backgroundUrl?: string;
    primaryColor?: string;
    cardStyle?: string;
    titleText?: string;
    subtitleText?: string;
    policyUrl?: string;
  }) {
    return this.prisma.portalConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    });
  }
}
