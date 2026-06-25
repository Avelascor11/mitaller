import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EconomicsService } from '../economics/economics.service';
import { PrismaService } from '../prisma/prisma.service';

interface EmployeeSaveBody {
  name?: string;
  role?: string | null;
  active?: boolean;
  hourlyRate?: number;
  orderBonusRate?: number;
  marginShareRate?: number;
  notes?: string | null;
}

interface AssignOrderBody {
  orderId?: string;
  orderNumber?: string;
  role?: string;
  units?: number;
  minutesSpent?: number;
}

interface WorkSessionBody {
  orderIds?: string[];
  orderNumbers?: string[];
  role?: string;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly economics: EconomicsService,
    private readonly config: ConfigService
  ) {}

  async list() {
    const employees = await this.prisma.employee.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        shifts: {
          where: { endedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1
        },
        workSessions: {
          where: { endedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1
        }
      }
    });
    return employees.map((employee) => this.employeeDto(employee));
  }

  async create(body: EmployeeSaveBody) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('El nombre del empleado es obligatorio');

    const employee = await this.prisma.employee.create({
      data: {
        name,
        role: this.cleanNullable(body.role),
        hourlyRate: this.positiveNumber(body.hourlyRate, this.defaultHourlyRate()),
        orderBonusRate: this.positiveNumber(body.orderBonusRate, this.defaultOrderBonus()),
        marginShareRate: this.rate(body.marginShareRate, this.defaultMarginShare()),
        notes: this.cleanNullable(body.notes)
      }
    });
    return this.employeeDto(employee);
  }

  async update(id: string, body: EmployeeSaveBody) {
    await this.ensureEmployee(id);
    const data: any = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('El nombre del empleado no puede estar vacío');
      data.name = name;
    }
    if (body.role !== undefined) data.role = this.cleanNullable(body.role);
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.hourlyRate !== undefined) data.hourlyRate = this.positiveNumber(body.hourlyRate, this.defaultHourlyRate());
    if (body.orderBonusRate !== undefined) data.orderBonusRate = this.positiveNumber(body.orderBonusRate, this.defaultOrderBonus());
    if (body.marginShareRate !== undefined) data.marginShareRate = this.rate(body.marginShareRate, this.defaultMarginShare());
    if (body.notes !== undefined) data.notes = this.cleanNullable(body.notes);

    const employee = await this.prisma.employee.update({ where: { id }, data });
    return this.employeeDto(employee);
  }

  async clockIn(id: string) {
    await this.ensureEmployee(id);
    const open = await this.prisma.employeeShift.findFirst({
      where: { employeeId: id, endedAt: null },
      orderBy: { startedAt: 'desc' }
    });
    if (open) return this.shiftDto(open);
    const shift = await this.prisma.employeeShift.create({ data: { employeeId: id } });
    return this.shiftDto(shift);
  }

  async clockOut(id: string, breakMinutes?: number) {
    await this.ensureEmployee(id);
    const open = await this.prisma.employeeShift.findFirst({
      where: { employeeId: id, endedAt: null },
      orderBy: { startedAt: 'desc' }
    });
    if (!open) throw new BadRequestException('Este empleado no tiene un turno abierto');
    const shift = await this.prisma.employeeShift.update({
      where: { id: open.id },
      data: {
        endedAt: new Date(),
        breakMinutes: Math.max(0, Math.trunc(Number(breakMinutes ?? open.breakMinutes ?? 0)))
      }
    });
    return this.shiftDto(shift);
  }

  async assignOrder(employeeId: string, body: AssignOrderBody) {
    await this.ensureEmployee(employeeId);
    const order = await this.findOrder(body.orderId, body.orderNumber);
    const role = (body.role?.trim() || 'PREPARACION').toUpperCase();
    const units = Math.max(1, Math.trunc(Number(body.units ?? 1)));
    const minutesSpent = Math.max(0, Math.trunc(Number(body.minutesSpent ?? 0)));

    const contribution = await this.prisma.employeeOrderContribution.upsert({
      where: { employeeId_orderId_role: { employeeId, orderId: order.id, role } },
      create: { employeeId, orderId: order.id, role, units, minutesSpent },
      update: { units, minutesSpent }
    });
    return this.contributionDto(contribution, order);
  }

  async startWorkSession(employeeId: string, body: WorkSessionBody) {
    await this.ensureEmployee(employeeId);
    const role = (body.role?.trim() || 'PREPARACION').toUpperCase();
    const orders = await this.findOrders(body.orderIds, body.orderNumbers);
    if (orders.length === 0) throw new BadRequestException('Elige al menos un pedido para preparar');

    const openSession = await this.prisma.employeeWorkSession.findFirst({
      where: { employeeId, endedAt: null },
      orderBy: { startedAt: 'desc' }
    });
    if (openSession) {
      throw new BadRequestException('Este empleado ya tiene un lote de pedidos en marcha');
    }

    await this.clockIn(employeeId);
    const session = await this.prisma.employeeWorkSession.create({
      data: {
        employeeId,
        role,
        orderIds: orders.map((order) => order.id),
        orderNumbers: orders.map((order) => order.orderNumber)
      }
    });
    return this.workSessionDto(session);
  }

  async finishWorkSession(employeeId: string, sessionId: string) {
    await this.ensureEmployee(employeeId);
    const session = await this.prisma.employeeWorkSession.findFirst({
      where: { id: sessionId, employeeId, endedAt: null }
    });
    if (!session) throw new NotFoundException('Lote de trabajo no encontrado o ya finalizado');

    const endedAt = new Date();
    const totalMinutes = Math.max(1, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60000));
    const orders = await this.prisma.order.findMany({
      where: { id: { in: session.orderIds } },
      include: { items: true }
    });
    const weights = new Map(orders.map((order) => [
      order.id,
      Math.max(1, order.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0))
    ]));
    const totalWeight = Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0) || orders.length || 1;
    let assignedMinutes = 0;
    const ordered = orders.sort((a, b) => session.orderIds.indexOf(a.id) - session.orderIds.indexOf(b.id));

    for (const [index, order] of ordered.entries()) {
      const weight = weights.get(order.id) ?? 1;
      const minutesSpent = index === ordered.length - 1
        ? Math.max(1, totalMinutes - assignedMinutes)
        : Math.max(1, Math.round((totalMinutes * weight) / totalWeight));
      assignedMinutes += minutesSpent;
      const units = Math.max(1, order.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0));
      await this.prisma.employeeOrderContribution.upsert({
        where: { employeeId_orderId_role: { employeeId, orderId: order.id, role: session.role } },
        create: { employeeId, orderId: order.id, role: session.role, units, minutesSpent },
        update: { units, minutesSpent }
      });
    }

    const finished = await this.prisma.employeeWorkSession.update({
      where: { id: session.id },
      data: { endedAt }
    });
    return {
      ...this.workSessionDto(finished),
      totalMinutes,
      orders: ordered.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        units: weights.get(order.id) ?? 1
      }))
    };
  }

  async summary(from?: string, to?: string) {
    const { start, end } = this.parseRange(from, to);
    const employees = await this.prisma.employee.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        shifts: {
          where: { startedAt: { lte: end }, OR: [{ endedAt: null }, { endedAt: { gte: start } }] },
          orderBy: { startedAt: 'asc' }
        },
        contributions: {
          where: { createdAt: { gte: start, lte: end } },
          include: { order: { include: { items: true, shipments: true } } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    const allContributions = employees.flatMap((employee) => employee.contributions);
    const contributorsPerOrder = allContributions.reduce((map, contribution) => {
      map.set(contribution.orderId, (map.get(contribution.orderId) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const marginByOrder = new Map<string, number>();
    for (const contribution of allContributions) {
      if (!marginByOrder.has(contribution.orderId)) {
        const breakdown = await this.economics.orderBreakdown(contribution.order.id);
        marginByOrder.set(contribution.orderId, breakdown?.netMargin ?? 0);
      }
    }

    const maxLaborMarginRate = this.maxLaborMarginRate();
    const rows = employees.map((employee) => {
      const shiftHours = employee.shifts.reduce((sum, shift) => sum + this.shiftHoursInRange(shift, start, end), 0);
      const orderMinutes = employee.contributions.reduce((sum, contribution) => sum + (contribution.minutesSpent ?? 0), 0);
      const orderHours = orderMinutes / 60;
      const paidHours = Math.max(shiftHours, orderHours);
      const orderCount = employee.contributions.length;
      const units = employee.contributions.reduce((sum, contribution) => sum + contribution.units, 0);
      const generatedMargin = employee.contributions.reduce((sum, contribution) => {
        const margin = marginByOrder.get(contribution.orderId) ?? 0;
        const split = contributorsPerOrder.get(contribution.orderId) ?? 1;
        return sum + (margin / split);
      }, 0);
      const basePay = paidHours * employee.hourlyRate;
      const orderBonus = orderCount * employee.orderBonusRate;
      const marginBonus = Math.max(0, generatedMargin) * employee.marginShareRate;
      const suggestedPay = basePay + orderBonus + marginBonus;
      const maxRecommendedByMargin = Math.max(0, generatedMargin) * maxLaborMarginRate;
      const laborCostPct = generatedMargin > 0 ? (suggestedPay / generatedMargin) * 100 : null;
      const status = this.employeePayStatus(suggestedPay, generatedMargin, maxRecommendedByMargin);

      return {
        employee: this.employeeDto(employee),
        hours: this.round(paidHours),
        shiftHours: this.round(shiftHours),
        orderHours: this.round(orderHours),
        orderMinutes,
        openShift: employee.shifts.some((shift) => !shift.endedAt),
        orders: orderCount,
        units,
        generatedMargin: this.money(generatedMargin),
        basePay: this.money(basePay),
        orderBonus: this.money(orderBonus),
        marginBonus: this.money(marginBonus),
        suggestedPay: this.money(suggestedPay),
        maxRecommendedByMargin: this.money(maxRecommendedByMargin),
        laborCostPct: laborCostPct == null ? null : this.round(laborCostPct),
        status,
        warning: this.employeeWarning(status, generatedMargin, maxRecommendedByMargin),
        recentOrders: employee.contributions.slice(-5).reverse().map((contribution) => ({
          id: contribution.id,
          role: contribution.role,
          units: contribution.units,
          minutesSpent: contribution.minutesSpent ?? 0,
          createdAt: contribution.createdAt,
          orderId: contribution.order.id,
          orderNumber: contribution.order.orderNumber,
          customerName: contribution.order.customerName
        }))
      };
    });

    const totals = rows.reduce((acc, row) => {
      acc.hours += row.hours;
      acc.shiftHours += row.shiftHours;
      acc.orderHours += row.orderHours;
      acc.orderMinutes += row.orderMinutes;
      acc.orders += row.orders;
      acc.units += row.units;
      acc.generatedMargin += row.generatedMargin;
      acc.basePay += row.basePay;
      acc.orderBonus += row.orderBonus;
      acc.marginBonus += row.marginBonus;
      acc.suggestedPay += row.suggestedPay;
      return acc;
    }, { hours: 0, shiftHours: 0, orderHours: 0, orderMinutes: 0, orders: 0, units: 0, generatedMargin: 0, basePay: 0, orderBonus: 0, marginBonus: 0, suggestedPay: 0 });

    const laborCostPct = totals.generatedMargin > 0 ? (totals.suggestedPay / totals.generatedMargin) * 100 : null;

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      currency: 'EUR',
      maxLaborMarginRate,
      totals: {
        hours: this.round(totals.hours),
        shiftHours: this.round(totals.shiftHours),
        orderHours: this.round(totals.orderHours),
        orderMinutes: totals.orderMinutes,
        orders: totals.orders,
        units: totals.units,
        generatedMargin: this.money(totals.generatedMargin),
        basePay: this.money(totals.basePay),
        orderBonus: this.money(totals.orderBonus),
        marginBonus: this.money(totals.marginBonus),
        suggestedPay: this.money(totals.suggestedPay),
        laborCostPct: laborCostPct == null ? null : this.round(laborCostPct)
      },
      employees: rows
    };
  }

  private async ensureEmployee(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Empleado no encontrado');
    return employee;
  }

  private async findOrder(orderId?: string, orderNumber?: string) {
    const id = orderId?.trim();
    const number = orderNumber?.trim().replace(/^#/, '');
    if (!id && !number) throw new BadRequestException('Indica un pedido');
    const order = await this.prisma.order.findFirst({
      where: { OR: [id ? { id } : {}, number ? { orderNumber: number } : {}].filter((item) => Object.keys(item).length > 0) as any[] }
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  private async findOrders(orderIds?: string[], orderNumbers?: string[]) {
    const ids = [...new Set((orderIds ?? []).map((value) => value?.trim()).filter(Boolean))] as string[];
    const numbers = [...new Set((orderNumbers ?? []).map((value) => value?.trim().replace(/^#/, '')).filter(Boolean))] as string[];
    if (ids.length === 0 && numbers.length === 0) return [];
    return this.prisma.order.findMany({
      where: {
        OR: [
          ids.length ? { id: { in: ids } } : undefined,
          numbers.length ? { orderNumber: { in: numbers } } : undefined
        ].filter(Boolean) as any[]
      },
      include: { items: true },
      orderBy: { orderedAt: 'asc' }
    });
  }

  private parseRange(from?: string, to?: string) {
    const now = new Date();
    const start = from ? new Date(`${from}T00:00:00.000`) : new Date(now);
    if (!from) start.setHours(0, 0, 0, 0);
    const end = to ? new Date(`${to}T23:59:59.999`) : new Date(start);
    if (!to) end.setHours(23, 59, 59, 999);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Rango de fechas invalido');
    }
    return start <= end ? { start, end } : { start: end, end: start };
  }

  private shiftHoursInRange(shift: any, start: Date, end: Date) {
    const shiftStart = new Date(Math.max(shift.startedAt.getTime(), start.getTime()));
    const rawEnd = shift.endedAt ?? new Date();
    const shiftEnd = new Date(Math.min(rawEnd.getTime(), end.getTime()));
    if (shiftEnd <= shiftStart) return 0;
    const minutes = (shiftEnd.getTime() - shiftStart.getTime()) / 60000;
    return Math.max(0, minutes - (shift.breakMinutes ?? 0)) / 60;
  }

  private employeePayStatus(suggestedPay: number, generatedMargin: number, maxRecommendedByMargin: number) {
    if (generatedMargin <= 0 && suggestedPay > 0) return 'NO_MARGIN';
    if (maxRecommendedByMargin > 0 && suggestedPay > maxRecommendedByMargin) return 'HIGH';
    return 'OK';
  }

  private employeeWarning(status: string, generatedMargin: number, maxRecommendedByMargin: number) {
    if (status === 'NO_MARGIN') return 'No hay margen asignado: paga horas, pero revisa si faltan pedidos asignados.';
    if (status === 'HIGH') return `El sueldo supera el tope recomendado por margen (${this.money(maxRecommendedByMargin)}).`;
    if (generatedMargin <= 0) return 'Sin pedidos asignados en este rango.';
    return null;
  }

  private employeeDto(employee: any) {
    return {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      active: employee.active,
      hourlyRate: Number(employee.hourlyRate ?? 0),
      orderBonusRate: Number(employee.orderBonusRate ?? 0),
      marginShareRate: Number(employee.marginShareRate ?? 0),
      notes: employee.notes,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
      openShift: employee.shifts?.find((shift: any) => !shift.endedAt) ? this.shiftDto(employee.shifts.find((shift: any) => !shift.endedAt)) : null,
      openWorkSession: employee.workSessions?.find((session: any) => !session.endedAt) ? this.workSessionDto(employee.workSessions.find((session: any) => !session.endedAt)) : null
    };
  }

  private shiftDto(shift: any) {
    return {
      id: shift.id,
      employeeId: shift.employeeId,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt,
      breakMinutes: shift.breakMinutes ?? 0
    };
  }

  private contributionDto(contribution: any, order: any) {
    return {
      id: contribution.id,
      employeeId: contribution.employeeId,
      orderId: contribution.orderId,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      role: contribution.role,
      units: contribution.units,
      minutesSpent: contribution.minutesSpent ?? 0,
      createdAt: contribution.createdAt
    };
  }

  private workSessionDto(session: any) {
    return {
      id: session.id,
      employeeId: session.employeeId,
      role: session.role,
      orderIds: session.orderIds ?? [],
      orderNumbers: session.orderNumbers ?? [],
      startedAt: session.startedAt,
      endedAt: session.endedAt
    };
  }

  private defaultHourlyRate() {
    return this.moneyConfig('EMPLOYEE_DEFAULT_HOURLY_RATE', 8);
  }

  private defaultOrderBonus() {
    return this.moneyConfig('EMPLOYEE_DEFAULT_ORDER_BONUS', 0.35);
  }

  private defaultMarginShare() {
    return this.rateConfig('EMPLOYEE_DEFAULT_MARGIN_SHARE', 0.08);
  }

  private maxLaborMarginRate() {
    return this.rateConfig('EMPLOYEE_MAX_LABOR_MARGIN_RATE', 0.25);
  }

  private moneyConfig(key: string, fallback: number) {
    const raw = this.config.get<string>(key);
    const parsed = Number(raw?.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private rateConfig(key: string, fallback: number) {
    return this.rate(this.moneyConfig(key, fallback), fallback);
  }

  private positiveNumber(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private rate(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed > 1 ? parsed / 100 : parsed;
  }

  private cleanNullable(value?: string | null) {
    const cleaned = value?.trim();
    return cleaned ? cleaned : null;
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private round(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
