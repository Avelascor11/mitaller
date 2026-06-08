import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KlaviyoService } from '../klaviyo/klaviyo.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyAdapter } from '../shopify/shopify.adapter';
import { MetaService } from '../meta/meta.service';
import { GoAffProAdapter } from './goaffpro.adapter';
import { GoogleDriveAdapter } from './google-drive.adapter';

export interface CrewTier {
  tier: string;
  label: string;
  garments: number;
  accessories: number;
  minFollowers: number;
}

export interface CrewApplyProduct {
  productId: string;
  title: string;
  variantId?: string;
  sku?: string;
  size?: string;
  category: 'PRENDA' | 'ACCESORIO';
  imageUrl?: string;
}

export interface CrewApplyBody {
  igHandle: string;
  email?: string;
  fullName?: string;
  followers: number;
  phone?: string;
  shippingAddress?: string;
  contentUrl?: string;
  desiredCode?: string;
  products: CrewApplyProduct[];
  acceptedRights?: boolean;
  notes?: string;
}

function normalizeCode(raw?: string): string | null {
  const c = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length >= 3 && c.length <= 20 ? c : null;
}

@Injectable()
export class CrewService {
  private readonly logger = new Logger(CrewService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyAdapter,
    private readonly goaffpro: GoAffProAdapter,
    private readonly klaviyo: KlaviyoService,
    private readonly drive: GoogleDriveAdapter,
    private readonly meta: MetaService,
    private readonly config: ConfigService
  ) {}

  /** Approve a crew collaboration: create GoAffPro affiliate + referral code, store on the collab. */
  async approve(collaborationId: string) {
    const collab = await this.prisma.collaboration.findUnique({
      where: { id: collaborationId },
      include: { influencer: true }
    });
    if (!collab) throw new NotFoundException('Colaboración no encontrada');
    const inf = collab.influencer;
    if (!inf.email) throw new BadRequestException('El influencer no tiene email; añádelo antes de aprobar.');

    const ref = await this.goaffpro.ensureAffiliate({
      name: inf.fullName || inf.igHandle,
      email: inf.email,
      refCode: collab.requestedCode || inf.igHandle
    });

    const updated = await this.prisma.collaboration.update({
      where: { id: collab.id },
      data: {
        status: 'PRODUCT_SENT',
        discountCode: ref.code || collab.discountCode,
        affiliateId: String(ref.id),
        referralUrl: ref.referralUrl
      }
    });
    await this.prisma.influencer.update({
      where: { id: inf.id },
      data: { stage: 'NEGOTIATING' }
    }).catch(() => undefined);

    return { ok: true, code: ref.code, referralUrl: ref.referralUrl, affiliateId: ref.id, collaboration: updated };
  }

  /** Combined influencer performance: GoAffPro sales (their code) + Meta campaigns named with their @. */
  async affiliatePerformance(collaborationId: string, from?: string, to?: string) {
    const collab = await this.prisma.collaboration.findUnique({
      where: { id: collaborationId },
      include: { influencer: true }
    });
    if (!collab) throw new NotFoundException('Colaboración no encontrada');

    // GoAffPro sales
    let referral = { configured: false as boolean, code: collab.discountCode ?? null as string | null, ordersCount: 0, salesTotal: 0, commission: 0 };
    if (collab.affiliateId) {
      try { referral = { configured: true, ...(await this.goaffpro.performance(Number(collab.affiliateId))) }; } catch { /* keep defaults */ }
    }

    // Meta campaigns whose name mentions their @handle
    const handle = collab.influencer.igHandle.toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const start = from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    let metaSpend = 0, metaPurchases = 0, metaRevenue = 0;
    let matchedCampaigns: Array<{ name: string; spend: number; roas: number | null; purchases: number }> = [];
    try {
      const summary = await this.meta.summary(start, to ?? today);
      const matches = (summary.campaigns ?? []).filter((c: any) =>
        `${c.name}`.toLowerCase().includes(handle) || `${c.name}`.toLowerCase().includes(handle.replace(/^@/, '')));
      matchedCampaigns = matches.map((c: any) => ({ name: c.name, spend: c.spend, roas: c.roas, purchases: c.purchases }));
      metaSpend = matches.reduce((s: number, c: any) => s + (c.spend ?? 0), 0);
      metaPurchases = matches.reduce((s: number, c: any) => s + (c.purchases ?? 0), 0);
      metaRevenue = matches.reduce((s: number, c: any) => s + (c.purchaseValue ?? 0), 0);
    } catch { /* meta not configured */ }

    // Verdict: total attributed revenue (referral sales + meta) vs ad spend on their campaigns
    const totalRevenue = +(referral.salesTotal + metaRevenue).toFixed(2);
    const roas = metaSpend > 0 ? +(totalRevenue / metaSpend).toFixed(2) : null;
    let status: 'WORKING' | 'WATCH' | 'UNDERPERFORMING' | 'NO_DATA';
    let headline: string;
    if (referral.ordersCount === 0 && metaPurchases === 0 && metaSpend < 5) {
      status = 'NO_DATA';
      headline = 'Aún sin datos suficientes. Dale tiempo a que publique y venda.';
    } else if (metaSpend >= 5 && roas != null && roas < 1) {
      status = 'UNDERPERFORMING';
      headline = `Gasta más de lo que genera (ROAS ${roas}x). Revisa o pausa su campaña.`;
    } else if (referral.ordersCount > 0 || (roas != null && roas >= 1.5) || metaPurchases > 0) {
      status = 'WORKING';
      headline = `Funciona: ${referral.ordersCount} ventas con su código${metaSpend > 0 ? `, ROAS ${roas ?? '—'}x` : ''}.`;
    } else {
      status = 'WATCH';
      headline = 'Va flojo, vigílalo unos días más.';
    }

    return {
      code: referral.code,
      referralUrl: collab.referralUrl ?? null,
      referral,
      meta: { spend: +metaSpend.toFixed(2), purchases: metaPurchases, revenue: +metaRevenue.toFixed(2), campaigns: matchedCampaigns },
      totalRevenue,
      roas,
      status,
      headline
    };
  }

  /** Reward tier by follower count. */
  tierFor(followers: number): CrewTier {
    if (followers >= 15000) return { tier: 'ELITE', label: '2 prendas + 1 accesorio', garments: 2, accessories: 1, minFollowers: 15000 };
    if (followers >= 10000) return { tier: 'PRO', label: '2 prendas', garments: 2, accessories: 0, minFollowers: 10000 };
    if (followers >= 5000) return { tier: 'PLUS', label: '1 prenda + 1 accesorio', garments: 1, accessories: 1, minFollowers: 5000 };
    if (followers >= 1000) return { tier: 'BASE', label: '1 prenda', garments: 1, accessories: 0, minFollowers: 1000 };
    return { tier: 'WAITLIST', label: 'Lista de espera', garments: 0, accessories: 0, minFollowers: 0 };
  }

  async catalog() {
    if (!this.shopify.hasCredentials()) return { prendas: [], accesorios: [] };
    const products = await this.shopify.crewCatalog();
    return {
      prendas: products.filter((p: any) => p.category === 'PRENDA'),
      accesorios: products.filter((p: any) => p.category === 'ACCESORIO')
    };
  }

  async apply(body: CrewApplyBody) {
    const igHandle = (body.igHandle ?? '').replace(/^@/, '').trim().toLowerCase();
    if (!igHandle) throw new BadRequestException('Instagram (@usuario) requerido');
    const followers = Number(body.followers);
    if (!Number.isFinite(followers) || followers < 0) throw new BadRequestException('Nº de seguidores no válido');

    const tier = this.tierFor(followers);
    if (tier.tier === 'WAITLIST') {
      // Still capture them, but as a prospect with no reward.
      await this.upsertInfluencer(igHandle, body, followers, 'WAITLIST');
      return { ok: true, status: 'WAITLIST', tier, message: 'Te has unido a la lista de espera. Te avisamos cuando crezcas un poco más.' };
    }

    const products = body.products ?? [];
    const garments = products.filter((p) => p.category === 'PRENDA').length;
    const accessories = products.filter((p) => p.category === 'ACCESORIO').length;
    if (garments > tier.garments || accessories > tier.accessories) {
      throw new BadRequestException(`Tu tramo permite ${tier.label}. Has elegido de más.`);
    }
    if (garments === 0 && tier.garments > 0) {
      throw new BadRequestException('Elige al menos una prenda.');
    }
    if (body.acceptedRights !== true) {
      throw new BadRequestException('Debes aceptar la cesión de derechos del contenido.');
    }
    const fullName = body.fullName?.trim();
    const phone = body.phone?.trim();
    const shippingAddress = body.shippingAddress?.trim();
    if (!fullName) throw new BadRequestException('Nombre completo requerido.');
    if (!body.email?.trim()) throw new BadRequestException('Email requerido.');
    if (!phone) throw new BadRequestException('Teléfono de contacto requerido.');
    if (!shippingAddress) throw new BadRequestException('Dirección de envío requerida.');

    const influencer = await this.upsertInfluencer(igHandle, body, followers, tier.tier);

    // One open crew collaboration per application
    const productSummary = products.map((p) => `${p.title}${p.size ? ` (${p.size})` : ''}`).join(', ');
    const collab = await this.prisma.collaboration.create({
      data: {
        influencerId: influencer.id,
        title: `Crew Speedwear · ${tier.tier}`,
        type: 'GIFT',
        status: 'OPEN',
        tier: tier.tier,
        productSent: productSummary || null,
        deliverables: '1 reel + 3 stories etiquetando @speedwear.es',
        productsJson: products as any,
        shippingJson: { fullName, email: body.email.trim(), phone, address: shippingAddress } as any,
        contentUrl: body.contentUrl?.trim() || null,
        requestedCode: normalizeCode(body.desiredCode) ?? normalizeCode(igHandle),
        notes: body.notes?.trim() || null
      }
    });

    // Create a €0 Shopify order with the influencer's name so the pack flows into picking.
    let orderName: string | null = null;
    try {
      orderName = await this.createGiftOrder({ fullName, email: body.email.trim(), phone, address: shippingAddress, igHandle, products }, collab.id);
    } catch (e) {
      this.logger.warn(`Crew gift order failed for @${igHandle}: ${(e as Error).message}`);
    }

    // Per-influencer Google Drive folder for their UGC.
    let uploadUrl = this.config.get<string>('CREW_UPLOAD_URL')
      ?? (this.drive.parentId ? `https://drive.google.com/drive/folders/${this.drive.parentId}` : 'https://drive.google.com/');
    try {
      const folder = await this.drive.createInfluencerFolder(`@${igHandle} — ${fullName}`);
      if (folder) {
        uploadUrl = folder;
        await this.prisma.collaboration.update({ where: { id: collab.id }, data: { driveFolderUrl: folder } }).catch(() => undefined);
      }
    } catch (e) {
      this.logger.warn(`Crew drive folder failed for @${igHandle}: ${(e as Error).message}`);
    }

    // Welcome email (Klaviyo flow "Crew Welcome") with the content brief + their upload folder.
    try {
      await this.klaviyo.trackCrewWelcome({
        email: body.email.trim(),
        name: fullName,
        igHandle,
        tier: tier.tier,
        products: productSummary,
        orderName,
        uploadUrl
      });
    } catch (e) {
      this.logger.warn(`Crew welcome email failed for @${igHandle}: ${(e as Error).message}`);
    }

    return { ok: true, status: 'APPLIED', tier, influencerId: influencer.id, collaborationId: collab.id, orderName, message: '¡Solicitud recibida! Preparamos tu pack y te avisamos cuando salga el envío 🚚' };
  }

  private async createGiftOrder(
    input: { fullName: string; email: string; phone: string; address: string; igHandle: string; products: CrewApplyProduct[] },
    collaborationId: string
  ) {
    if (!this.shopify.hasCredentials()) return null;
    const lineItems = input.products
      .filter((p) => p.variantId)
      .map((p) => ({ variantId: p.variantId!, quantity: 1 }));
    if (!lineItems.length) {
      this.logger.warn(`Crew order skipped @${input.igHandle}: no variant IDs`);
      return null;
    }
    const [firstName, ...rest] = input.fullName.split(' ');
    const draft = await this.shopify.createDraftOrder({
      customerEmail: input.email,
      note: `Speedwear Crew · @${input.igHandle} · regalo influencer`,
      tags: ['crew', 'influencer', 'regalo'],
      shippingAddress: {
        firstName: firstName || input.fullName,
        lastName: rest.join(' ') || '.',
        address1: input.address,
        countryCode: 'ES',
        phone: input.phone
      },
      lineItems,
      appliedDiscount: { valueType: 'PERCENTAGE', value: 100, title: 'Speedwear Crew', description: `Regalo crew @${input.igHandle}` }
    });
    const completed = await this.shopify.completeDraftOrder(draft.id);
    await this.prisma.collaboration.update({
      where: { id: collaborationId },
      data: { shopifyOrderId: completed.orderId, shopifyOrderName: completed.orderName, status: 'PRODUCT_SENT' }
    }).catch(() => undefined);
    return completed.orderName;
  }

  private async upsertInfluencer(igHandle: string, body: CrewApplyBody, followers: number, tier: string) {
    const existing = await this.prisma.influencer.findUnique({ where: { igHandle } });
    const tags = [...new Set([...(existing?.tags ?? []), 'crew', `tier:${tier.toLowerCase()}`])];
    if (existing) {
      return this.prisma.influencer.update({
        where: { id: existing.id },
        data: {
          followers,
          email: body.email?.trim() || existing.email,
          fullName: body.fullName?.trim() || existing.fullName,
          phone: body.phone?.trim() || existing.phone,
          source: existing.source ?? 'CREW_FORM',
          tags,
          stage: existing.stage === 'PROSPECT' ? 'CONTACTED' : existing.stage
        }
      });
    }
    return this.prisma.influencer.create({
      data: {
        igHandle,
        followers,
        email: body.email?.trim() || null,
        fullName: body.fullName?.trim() || null,
        phone: body.phone?.trim() || null,
        source: 'CREW_FORM',
        stage: 'CONTACTED',
        tags
      }
    });
  }
}
