import { describe, expect, it } from 'vitest';
import { PriorityService } from '../src/priority/priority.service';

describe('PriorityService', () => {
  const service = new PriorityService();

  it('marca express como CRITICAL', () => {
    const result = service.calculate({
      orderedAt: new Date('2026-05-05T08:00:00Z'),
      shippingMethod: 'Express 24h',
      financialStatus: 'paid'
    }, new Date('2026-05-05T09:00:00Z'));
    expect(result.priorityLevel).toBe('CRITICAL');
  });

  it('calcula deadline estandar a 48 horas laborables', () => {
    const deadline = service.calculateDeadline(new Date('2026-05-05T08:00:00Z'), 'Correos Estandar');
    expect(deadline.toISOString()).toBe('2026-05-07T08:00:00.000Z');
  });

  it('no cuenta sabado ni domingo para deadline estandar', () => {
    const deadline = service.calculateDeadline(new Date('2026-05-08T16:00:00Z'), 'Correos Estandar');
    expect(deadline.toISOString()).toBe('2026-05-12T16:00:00.000Z');
  });

  it('mueve pedidos creados en fin de semana al siguiente dia laborable antes de sumar plazo', () => {
    const deadline = service.calculateDeadline(new Date('2026-05-09T10:00:00Z'), 'Correos Estandar');
    expect(deadline.toISOString()).toBe('2026-05-12T22:00:00.000Z');
  });

  it('marca estandar pasado de plazo como CRITICAL', () => {
    const result = service.calculate({
      orderedAt: new Date('2026-05-03T08:00:00Z'),
      shippingMethod: 'Correos Estandar',
      financialStatus: 'paid'
    }, new Date('2026-05-06T09:00:00Z'));
    expect(result.priorityLevel).toBe('CRITICAL');
  });

  it('marca estandar con mas de 24 horas pero dentro de plazo como HIGH', () => {
    const result = service.calculate({
      orderedAt: new Date('2026-05-05T08:00:00Z'),
      shippingMethod: 'Correos Estandar',
      financialStatus: 'paid'
    }, new Date('2026-05-06T09:00:00Z'));
    expect(result.priorityLevel).toBe('HIGH');
  });

  it('bloquea cuando falta stock', () => {
    const result = service.calculate({
      orderedAt: new Date('2026-05-05T08:00:00Z'),
      shippingMethod: 'Correos Estandar',
      financialStatus: 'paid',
      hasMissingStock: true
    });
    expect(result.priorityLevel).toBe('BLOCKED');
    expect(result.operationalStatus).toBe('WAITING_STOCK');
  });
});
