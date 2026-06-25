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
});
