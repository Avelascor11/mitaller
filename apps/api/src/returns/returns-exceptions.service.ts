import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const VALID_TYPES = ['EXTEND_WINDOW', 'FREE_LABEL', 'ACCEPT_EXPIRED', 'BLOCK'];

export interface ResolvedExceptions {
  extendDays: number;
  freeLabel: boolean;
  acceptExpired: boolean;
  blocked: boolean;
  blockedReason?: string;
}

@Injectable()
export class ReturnsExceptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve all exceptions applicable to a given order/email */
  async resolve(orderNumber: string, customerEmail: string): Promise<ResolvedExceptions> {
    const normalizedOrderNumber = orderNumber.replace(/^#/, '').trim();
    const candidates = [orderNumber, normalizedOrderNumber, `#${normalizedOrderNumber}`];

    const now = new Date();
    const matches = await this.prisma.returnException.findMany({
      where: {
        active: true,
        OR: [
          { orderNumber: { in: candidates } },
          { customerEmail: { equals: customerEmail.toLowerCase().trim(), mode: 'insensitive' } }
        ],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }]
      }
    });

    const result: ResolvedExceptions = {
      extendDays: 0,
      freeLabel: false,
      acceptExpired: false,
      blocked: false
    };

    for (const ex of matches) {
      switch (ex.type) {
        case 'EXTEND_WINDOW':
          result.extendDays += ex.extraDays ?? 0;
          break;
        case 'FREE_LABEL':
          result.freeLabel = true;
          break;
        case 'ACCEPT_EXPIRED':
          result.acceptExpired = true;
          break;
        case 'BLOCK':
          result.blocked = true;
          result.blockedReason = ex.notes ?? 'Pedido bloqueado por administración';
          break;
      }
    }

    return result;
  }

  findAll() {
    return this.prisma.returnException.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(input: {
    orderNumber?: string | null;
    customerEmail?: string | null;
    type: string;
    extraDays?: number | null;
    notes?: string | null;
    expiresAt?: string | null;
  }) {
    if (!VALID_TYPES.includes(input.type)) {
      throw new BadRequestException(`Tipo inválido: ${input.type}`);
    }
    if (!input.orderNumber && !input.customerEmail) {
      throw new BadRequestException('Indica al menos número de pedido o email.');
    }
    if (input.type === 'EXTEND_WINDOW' && (!input.extraDays || input.extraDays <= 0)) {
      throw new BadRequestException('Para EXTEND_WINDOW indica días extra (>0).');
    }
    return this.prisma.returnException.create({
      data: {
        orderNumber: input.orderNumber?.trim() || null,
        customerEmail: input.customerEmail?.toLowerCase().trim() || null,
        type: input.type as never,
        extraDays: input.extraDays ?? null,
        notes: input.notes?.trim() || null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        active: true
      }
    });
  }

  async update(id: string, patch: { active?: boolean; notes?: string; extraDays?: number; expiresAt?: string | null }) {
    const data: Record<string, unknown> = {};
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.extraDays !== undefined) data.extraDays = patch.extraDays;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
    const existing = await this.prisma.returnException.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Excepción no encontrada');
    return this.prisma.returnException.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.prisma.returnException.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Excepción no encontrada');
    await this.prisma.returnException.delete({ where: { id } });
    return { deleted: true };
  }
}
