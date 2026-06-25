import { describe, expect, it } from 'vitest';
import { EmployeesService } from '../src/employees/employees.service';

describe('EmployeesService', () => {
  it('calcula sueldo por horas, pedido y margen repartido entre empleados', async () => {
    const order = {
      id: 'order-1',
      orderNumber: '9599',
      customerName: 'Cliente Test',
      items: [],
      shipments: []
    };
    const service = new EmployeesService(
      {
        employee: {
          findMany: async () => [
            {
              id: 'emp-1',
              name: 'Ana',
              role: 'Taller',
              active: true,
              hourlyRate: 10,
              orderBonusRate: 1,
              marginShareRate: 0.1,
              notes: null,
              createdAt: new Date('2026-06-25T08:00:00Z'),
              updatedAt: new Date('2026-06-25T08:00:00Z'),
              shifts: [{ id: 'shift-1', employeeId: 'emp-1', startedAt: new Date('2026-06-25T09:00:00Z'), endedAt: new Date('2026-06-25T11:00:00Z'), breakMinutes: 0 }],
              contributions: [{ id: 'c-1', employeeId: 'emp-1', orderId: 'order-1', role: 'PREPARACION', units: 1, minutesSpent: 150, createdAt: new Date('2026-06-25T11:30:00Z'), order }]
            },
            {
              id: 'emp-2',
              name: 'Luis',
              role: 'Packing',
              active: true,
              hourlyRate: 10,
              orderBonusRate: 1,
              marginShareRate: 0.1,
              notes: null,
              createdAt: new Date('2026-06-25T08:00:00Z'),
              updatedAt: new Date('2026-06-25T08:00:00Z'),
              shifts: [{ id: 'shift-2', employeeId: 'emp-2', startedAt: new Date('2026-06-25T10:00:00Z'), endedAt: new Date('2026-06-25T11:00:00Z'), breakMinutes: 0 }],
              contributions: [{ id: 'c-2', employeeId: 'emp-2', orderId: 'order-1', role: 'PACKING', units: 1, minutesSpent: 30, createdAt: new Date('2026-06-25T11:40:00Z'), order }]
            }
          ]
        }
      } as never,
      { orderBreakdown: async () => ({ netMargin: 100 }) } as never,
      { get: (key: string) => ({ EMPLOYEE_MAX_LABOR_MARGIN_RATE: '0.35' })[key] } as never
    );

    const summary = await service.summary('2026-06-25', '2026-06-25');

    expect(summary.totals.generatedMargin).toBe(100);
    expect(summary.totals.hours).toBe(3.5);
    expect(summary.totals.shiftHours).toBe(3);
    expect(summary.totals.orderHours).toBe(3);
    expect(summary.totals.orders).toBe(2);
    expect(summary.employees[0].generatedMargin).toBe(50);
    expect(summary.employees[0].hours).toBe(2.5);
    expect(summary.employees[0].shiftHours).toBe(2);
    expect(summary.employees[0].orderHours).toBe(2.5);
    expect(summary.employees[0].basePay).toBe(25);
    expect(summary.employees[0].orderBonus).toBe(1);
    expect(summary.employees[0].marginBonus).toBe(5);
    expect(summary.employees[0].suggestedPay).toBe(31);
    expect(summary.employees[1].suggestedPay).toBe(16);
  });

  it('finaliza un lote y reparte el tiempo segun unidades de cada pedido', async () => {
    const upserts: any[] = [];
    const startedAt = new Date(Date.now() - 30 * 60 * 1000);
    const service = new EmployeesService(
      {
        employee: { findUnique: async () => ({ id: 'emp-1' }) },
        employeeWorkSession: {
          findFirst: async () => ({
            id: 'session-1',
            employeeId: 'emp-1',
            role: 'PREPARACION',
            orderIds: ['order-1', 'order-2'],
            orderNumbers: ['9601', '9602'],
            startedAt,
            endedAt: null
          }),
          update: async ({ data }: any) => ({
            id: 'session-1',
            employeeId: 'emp-1',
            role: 'PREPARACION',
            orderIds: ['order-1', 'order-2'],
            orderNumbers: ['9601', '9602'],
            startedAt,
            endedAt: data.endedAt
          })
        },
        order: {
          findMany: async () => [
            { id: 'order-1', orderNumber: '9601', items: [{ quantity: 2 }] },
            { id: 'order-2', orderNumber: '9602', items: [{ quantity: 1 }] }
          ]
        },
        employeeOrderContribution: {
          upsert: async (args: any) => {
            upserts.push(args);
            return args.create;
          }
        }
      } as never,
      { orderBreakdown: async () => ({ netMargin: 0 }) } as never,
      { get: () => undefined } as never
    );

    const result = await service.finishWorkSession('emp-1', 'session-1');

    expect(result.totalMinutes).toBeGreaterThanOrEqual(29);
    expect(upserts).toHaveLength(2);
    expect(upserts[0].create.orderId).toBe('order-1');
    expect(upserts[0].create.minutesSpent).toBeGreaterThan(upserts[1].create.minutesSpent);
    expect(upserts[0].create.units).toBe(2);
    expect(upserts[1].create.units).toBe(1);
  });

  it('permite guardar horas manuales de un empleado para un dia', async () => {
    let deletedWhere: any;
    let createdData: any;
    const service = new EmployeesService(
      {
        employee: { findUnique: async () => ({ id: 'emp-1' }) },
        employeeShift: {
          deleteMany: async ({ where }: any) => {
            deletedWhere = where;
            return { count: 1 };
          },
          create: async ({ data }: any) => {
            createdData = data;
            return { id: 'shift-1', ...data };
          }
        }
      } as never,
      { orderBreakdown: async () => ({ netMargin: 0 }) } as never,
      { get: () => undefined } as never
    );

    const shift = await service.setManualHours('emp-1', { date: '2026-06-25', hours: 4.5 });

    expect(deletedWhere.employeeId).toBe('emp-1');
    expect(deletedWhere.notes.startsWith).toBe('MANUAL_HOURS:2026-06-25');
    expect(createdData.notes).toContain('MANUAL_HOURS:2026-06-25');
    expect((createdData.endedAt.getTime() - createdData.startedAt.getTime()) / 60000).toBe(270);
    expect(shift.employeeId).toBe('emp-1');
  });
});
