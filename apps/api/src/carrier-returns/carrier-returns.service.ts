import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KlaviyoService } from '../klaviyo/klaviyo.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyAdapter } from '../shopify/shopify.adapter';

type Reason = 'ABSENT' | 'NO_ATTEND' | 'WRONG_ADDRESS' | 'REFUSED' | 'OTHER';

@Injectable()
export class CarrierReturnsService {
  private readonly logger = new Logger(CarrierReturnsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyAdapter,
    private readonly klaviyo: KlaviyoService,
    private readonly config: ConfigService
  ) {}

  private get fee(): number {
    const raw = Number((this.config.get<string>('CARRIER_RETURN_FEE') ?? '').replace(',', '.'));
    return Number.isFinite(raw) && raw > 0 ? raw : 4.95;
  }

  list(status?: string) {
    return this.prisma.carrierReturn.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' }
    });
  }

  async stats() {
    const grouped = await this.prisma.carrierReturn.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(grouped.map((g) => [g.status, g._count]));
  }

  /** Register a returned-to-sender order. Pulls customer/email from our DB order if it exists. */
  async create(input: { orderNumber: string; reason?: Reason; notes?: string }) {
    const orderNumber = input.orderNumber?.trim();
    if (!orderNumber) throw new BadRequestException('Número de pedido requerido');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ orderNumber }, { orderNumber: `#${orderNumber.replace(/^#/, '')}` }] }
    });
    return this.prisma.carrierReturn.create({
      data: {
        orderId: order?.id ?? null,
        orderNumber: order?.orderNumber ?? orderNumber,
        customerName: order?.customerName ?? null,
        customerEmail: order?.customerEmail ?? null,
        reason: (input.reason ?? 'OTHER') as any,
        feeAmount: this.fee,
        notes: input.notes?.trim() || null
      }
    });
  }

  async update(id: string, input: { status?: string; customerEmail?: string; reason?: Reason; notes?: string; newAddress?: string }) {
    await this.get(id);
    const data: any = {};
    if (input.status) data.status = input.status;
    if (input.customerEmail !== undefined) data.customerEmail = input.customerEmail?.trim() || null;
    if (input.reason) data.reason = input.reason;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.newAddress !== undefined) data.newAddress = input.newAddress?.trim() || null;
    if (input.status === 'PAID') data.paidAt = new Date();
    if (input.status === 'RESHIPPED') data.reshippedAt = new Date();
    return this.prisma.carrierReturn.update({ where: { id }, data });
  }

  private async get(id: string) {
    const r = await this.prisma.carrierReturn.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Devolución no encontrada');
    return r;
  }

  /** Create a Shopify checkout link for the reship fee (also collects the corrected address) + email the customer. */
  async requestPayment(id: string) {
    const ret = await this.get(id);
    if (!ret.customerEmail) throw new BadRequestException('Falta el email del cliente. Añádelo antes de pedir el pago.');

    let invoiceUrl = ret.invoiceUrl;
    let draftOrderId = ret.draftOrderId;
    if (this.shopify.hasCredentials()) {
      const draft = await this.shopify.createDraftOrder({
        customerEmail: ret.customerEmail,
        note: `Reenvío pedido ${ret.orderNumber} (devuelto por Correos)`,
        tags: ['reenvio', 'correos-devuelto'],
        lineItems: [{ title: `Reenvío pedido ${ret.orderNumber}`, price: ret.feeAmount, quantity: 1 }]
      });
      invoiceUrl = draft.invoiceUrl;
      draftOrderId = draft.id;
    }

    await this.klaviyo.trackCarrierReturn({
      email: ret.customerEmail,
      customerName: ret.customerName ?? 'Hola',
      orderNumber: ret.orderNumber,
      fee: ret.feeAmount,
      payUrl: invoiceUrl ?? ''
    }).catch(() => undefined);

    return this.prisma.carrierReturn.update({
      where: { id },
      data: { invoiceUrl, draftOrderId, status: 'EMAILED', emailedAt: new Date() }
    });
  }
}
