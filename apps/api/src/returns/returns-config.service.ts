import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedConfig {
  windowDays: number;
  labelPrice: number;
  shippingProductCode: string | null;
  exchangePolicy: 'ANY' | 'SAME_TYPE' | 'VARIANT_ONLY';
  termsText: string | null;
  enabled: boolean;
}

@Injectable()
export class ReturnsConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ResolvedConfig> {
    const row = await this.prisma.returnConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {}
    });
    return {
      windowDays: row.windowDays,
      labelPrice: row.labelPrice,
      shippingProductCode: row.shippingProductCode,
      exchangePolicy: (row.exchangePolicy as 'ANY' | 'SAME_TYPE' | 'VARIANT_ONLY') ?? 'ANY',
      termsText: row.termsText,
      enabled: row.enabled
    };
  }

  async update(patch: Partial<ResolvedConfig>) {
    const data: Record<string, unknown> = {};
    if (patch.windowDays !== undefined) data.windowDays = patch.windowDays;
    if (patch.labelPrice !== undefined) data.labelPrice = patch.labelPrice;
    if (patch.shippingProductCode !== undefined) data.shippingProductCode = patch.shippingProductCode;
    if (patch.exchangePolicy !== undefined) data.exchangePolicy = patch.exchangePolicy;
    if (patch.termsText !== undefined) data.termsText = patch.termsText;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    await this.prisma.returnConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data
    });
    return this.get();
  }
}
