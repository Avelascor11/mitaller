import { createHmac } from 'node:crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { audienceWhere, blocks, fromKlaviyo, renderEmail, rules } from '../src/marketing/marketing.domain';
import { klaviyoContact, MarketingService } from '../src/marketing/marketing.service';

const env: Record<string, string> = {
  MARKETING_SMTP_HOST: 'smtp.example.com', MARKETING_SMTP_USER: 'user', MARKETING_SMTP_PASSWORD: 'pass', MARKETING_FROM_EMAIL: 'hola@speedwear.es',
  MARKETING_POSTAL_ADDRESS: 'Calle 1, Madrid', MARKETING_PUBLIC_API_URL: 'https://api.speedwear.es', MARKETING_SEND_ENABLED: 'true', MARKETING_EVENT_SECRET: 'x'.repeat(32), SHOPIFY_WEBHOOK_SECRET: 'shopify-secret'
};
function serviceWith(prisma: Record<string, any>, overrides: Record<string, string> = {}) {
  const values = { ...env, ...overrides };
  const db = { ...prisma, $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)) };
  return { service: new MarketingService(db as never, { get: (key: string) => values[key] } as never), db };
}
function contactTx(existing: Record<string, any> | null, saved: Record<string, any> = {}) {
  return {
    findUnique: vi.fn().mockResolvedValue(existing),
    upsert: vi.fn().mockImplementation(({ create, update }) => Promise.resolve({ id: existing?.id ?? 'contact-1', tags: [], ...(existing ?? {}), ...(existing ? update : create), ...saved }))
  };
}

describe('marketing domain', () => {
  it('escapa el contenido y solo enlaza URLs https', () => {
    const html = renderEmail({ subject: 'x', preheader: '', blocks: [{ type: 'text', text: '<script>alert(1)</script> {{firstName}}' }, { type: 'button', text: 'Ver', url: '{{event.checkoutUrl}}' }], event: { checkoutUrl: 'javascript:alert(1)' } }, { firstName: '<b>Ana</b>' }).html;
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(html).not.toContain('javascript:');
  });

  it('rechaza botones sin URL https', () => {
    expect(() => blocks([{ type: 'button', text: 'Comprar', url: 'http://speedwear.es' }])).toThrow(BadRequestException);
  });

  it('traduce condiciones de actividad a filtros de eventos y aperturas', () => {
    const now = new Date('2026-10-29T00:00:00Z');
    const where = audienceWhere(rules({ mode: 'all', conditions: [{ field: 'event', operator: 'not_in_last_days', value: 'Placed Order', days: 90 }, { field: 'opened', operator: 'in_last_days', days: 30 }] }), now);
    expect(where).toEqual({ status: 'SUBSCRIBED', AND: [
      { events: { none: { name: 'Placed Order', createdAt: { gte: new Date('2026-07-31T00:00:00Z') } } } },
      { messages: { some: { openedAt: { gte: new Date('2026-09-29T00:00:00Z') } } } }
    ] });
  });
});

describe('MarketingService contacts', () => {
  it('no baja a pendiente un suscriptor al reimportarlo sin estado', async () => {
    const marketingContact = contactTx({ id: 'c1', email: 'ana@example.com', status: 'SUBSCRIBED', tags: ['vip'], consentAt: new Date('2026-01-01'), consentSource: 'klaviyo' });
    const { service } = serviceWith({ marketingContact, marketingMessage: { updateMany: vi.fn() } });
    await service.importContacts({ contacts: [{ email: 'ANA@example.com', firstName: 'Ana', tags: ['rebajas'] }] });
    const update = marketingContact.upsert.mock.calls[0][0].update;
    expect(update.status).toBeUndefined();
    expect(update.tags).toEqual(['vip', 'rebajas']);
  });

  it('nunca reactiva un contacto dado de baja', async () => {
    const marketingContact = contactTx({ id: 'c1', email: 'ana@example.com', status: 'UNSUBSCRIBED', tags: [] });
    const { service } = serviceWith({ marketingContact, marketingMessage: { updateMany: vi.fn() } });
    await service.saveContact({ email: 'ana@example.com', status: 'SUBSCRIBED', consentSource: 'manual', consentAt: '2026-10-01T00:00:00Z' });
    expect(marketingContact.upsert.mock.calls[0][0].update.status).toBeUndefined();
  });

  it('mapea consentimiento y supresiones de Klaviyo', () => {
    const profile = (marketing: Record<string, unknown>) => ({ attributes: { email: 'Ana@Example.com', first_name: 'Ana', subscriptions: { email: { marketing } } } });
    expect(klaviyoContact(profile({ consent: 'SUBSCRIBED', can_receive_email_marketing: true, consent_timestamp: '2025-05-01T10:00:00Z', method: 'FORM' }))).toMatchObject({ email: 'ana@example.com', status: 'SUBSCRIBED', consentSource: 'klaviyo:FORM', tags: ['klaviyo'] });
    expect(klaviyoContact(profile({ consent: 'SUBSCRIBED', suppression: [{ reason: 'HARD_BOUNCE' }] }))?.status).toBe('BOUNCED');
    expect(klaviyoContact(profile({ consent: 'NEVER_SUBSCRIBED' }))?.status).toBe('PENDING');
    expect(klaviyoContact({ attributes: { phone_number: '+34600000000' } })).toBeNull();
  });
});

describe('MarketingService events', () => {
  function eventService(contactStatus: string, flows: Record<string, any>[]) {
    const marketingMessage = { updateMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), create: vi.fn() };
    const prisma = {
      marketingContact: contactTx({ id: 'c1', email: 'ana@example.com', status: contactStatus, tags: [] }),
      marketingEvent: { create: vi.fn().mockResolvedValue({ id: 'ev1', createdAt: new Date('2026-10-29T10:00:00Z') }) },
      marketingFlow: { findMany: vi.fn().mockResolvedValue(flows) },
      marketingTemplate: { findUnique: vi.fn().mockResolvedValue({ subject: 'Hola', preheader: '', blocks: [{ type: 'text', text: 'x' }] }) },
      marketingMessage
    };
    return { ...serviceWith(prisma), marketingMessage };
  }
  const flow = (extra: Record<string, unknown> = {}) => ({ id: 'f1', status: 'LIVE', trigger: 'Return Approved', stopOnEvent: null, transactional: false, reentryDays: 0, steps: [{ delayMinutes: 60, templateId: 't1' }], ...extra });

  it('las automatizaciones transaccionales llegan a contactos sin consentimiento de marketing', async () => {
    const { service, marketingMessage } = eventService('PENDING', [flow({ id: 'marketing' }), flow({ id: 'transactional', transactional: true })]);
    const result = await service.ingestEvent({ name: 'Return Approved', email: 'ana@example.com', externalId: 'r1' });
    expect(result.queued).toBe(1);
    expect(marketingMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ flowId: 'transactional', kind: 'TRANSACTIONAL', dueAt: new Date('2026-10-29T11:00:00Z') }) });
  });

  it('respeta la ventana de reentrada', async () => {
    const { service, marketingMessage } = eventService('SUBSCRIBED', [flow({ reentryDays: 7 })]);
    marketingMessage.count.mockResolvedValue(1);
    expect((await service.ingestEvent({ name: 'Return Approved', email: 'ana@example.com', externalId: 'r2' })).queued).toBe(0);
  });

  it('el evento disparador no cuenta como evento de salida', async () => {
    const marketingEvent = { count: vi.fn().mockResolvedValue(0) };
    const message = { id: 'm1', kind: 'MARKETING', contactId: 'c1', trackingToken: 't', payload: { subject: 'Te echamos de menos', preheader: '', blocks: [{ type: 'text', text: 'x' }], eventId: 'ev1', eventAt: '2026-08-01T00:00:00Z', stopOnEvent: 'Placed Order' }, contact: { id: 'c1', email: 'ana@example.com', status: 'SUBSCRIBED', unsubscribeToken: 'u' }, campaign: null, flow: { status: 'LIVE' } };
    const marketingMessage = { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue(message), update: vi.fn() };
    const { service } = serviceWith({ marketingEvent, marketingMessage });
    const transport = { sendMail: vi.fn().mockResolvedValue({ accepted: ['ana@example.com'], messageId: '<m1@speedwear.es>', response: '250 Ok 0100018b-abc' }) };
    await (service as any).deliver('m1', transport);
    expect(marketingEvent.count).toHaveBeenCalledWith({ where: expect.objectContaining({ name: { in: ['Placed Order'] }, id: { not: 'ev1' } }) });
    expect(marketingMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'SENT', providerMessageId: '0100018b-abc' }) });
    expect(transport.sendMail.mock.calls[0][0].headers['List-Unsubscribe']).toBe('<https://api.speedwear.es/marketing/public/unsubscribe/u?m=t>');
  });
});

describe('MarketingService integrations', () => {
  it('rechaza webhooks de Shopify sin firma válida', async () => {
    const { service } = serviceWith({});
    await expect(service.shopifyWebhook('orders/create', 'bad', Buffer.from('{}'), {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('convierte checkouts de Shopify en Started Checkout', async () => {
    const { service } = serviceWith({});
    const raw = Buffer.from('{"token":"abc"}');
    const hmac = createHmac('sha256', 'shopify-secret').update(raw).digest('base64');
    const shopifyConsent = vi.spyOn(service as any, 'shopifyConsent').mockResolvedValue(undefined);
    const ingest = vi.spyOn(service, 'ingestEvent').mockResolvedValue({ id: 'e', queued: 1, duplicate: false, attributed: false });
    await service.shopifyWebhook('checkouts/update', hmac, raw, { token: 'abc', email: 'Ana@Example.com', total_price: '39.90', abandoned_checkout_url: 'https://speedwear.es/checkouts/abc', line_items: [{ title: 'Sudadera', variant_title: 'M', quantity: 1 }] });
    expect(shopifyConsent).toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ name: 'Started Checkout', email: 'ana@example.com', externalId: 'shopify:checkout:abc', properties: expect.objectContaining({ checkoutUrl: 'https://speedwear.es/checkouts/abc', itemsText: '1× Sudadera (M)' }) }));
  });

  it('marca rebotes permanentes de SES y suprime el contacto', async () => {
    const marketingMessage = { findFirst: vi.fn().mockResolvedValue({ id: 'm1', contactId: 'c1' }), update: vi.fn(), updateMany: vi.fn() };
    const marketingContact = { updateMany: vi.fn() };
    const { service } = serviceWith({ marketingMessage, marketingContact });
    const notification = { Type: 'Notification', Message: JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent' }, mail: { messageId: 'ses-1', commonHeaders: { messageId: '<cm1abcdefghijklmnopqrstu@speedwear.es>' } } }) };
    await service.sesNotification('x'.repeat(32), JSON.stringify(notification));
    expect(marketingMessage.findFirst.mock.calls[0][0].where.OR).toEqual([{ providerMessageId: { in: ['ses-1', 'cm1abcdefghijklmnopqrstu@speedwear.es'] } }, { id: { in: ['cm1abcdefghijklmnopqrstu'] } }]);
    expect(marketingContact.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', status: { not: 'COMPLAINED' } }, data: expect.objectContaining({ status: 'BOUNCED' }) });
  });

  it('ignora rebotes temporales de SES', async () => {
    const { service } = serviceWith({});
    const notification = { Type: 'Notification', Message: JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Transient' }, mail: { messageId: 'ses-1' } }) };
    expect(await service.sesNotification('x'.repeat(32), JSON.stringify(notification))).toEqual({ ok: true, ignored: true });
  });
});

describe('Klaviyo templates', () => {
  const klaviyoHtml = `<html><body><p>Hola {{ first_name|default:'Ey' }},</p><a href="{{ event.extra.checkout_url }}">Volver</a> <a href="https://speedwear.es?utm_source=klaviyo&amp;utm_medium=email">Logo</a> <a href="mailto:info@speedwear.es">info</a><p>{% unsubscribe 'Darme de baja' %}</p>{% if person.x %}x{% endif %}</body></html>`;

  it('convierte etiquetas de Klaviyo y avisa de lo que no puede conservar', () => {
    const { html, warnings } = fromKlaviyo(klaviyoHtml);
    expect(html).toContain('Hola {{firstName|Ey}}');
    expect(html).toContain('href="{{event.checkoutUrl}}"');
    expect(html).toContain('<a href="{{unsubscribeUrl}}" style="color:inherit">Darme de baja</a>');
    expect(html).toContain('utm_source=speedwear_mail');
    expect(html).not.toContain('{%');
    expect(warnings.some(w => w.includes('person.x'))).toBe(true);
  });

  it('envía el HTML tal cual con enlaces seguidos, baja propia y sin inyectar código', () => {
    const payload = { subject: 's', preheader: '', blocks: [{ type: 'html' as const, text: fromKlaviyo(klaviyoHtml).html }], event: { checkoutUrl: 'https://speedwear.es/checkouts/1?a=1&b=2' } };
    const { html, links } = renderEmail(payload, { firstName: '<b>Ana</b>' }, { unsubscribeUrl: 'https://api.speedwear.es/u/1', address: 'Calle 1', pixelUrl: 'https://api.speedwear.es/o/1', trackLink: (_u, i) => `https://api.speedwear.es/c/${i}` });
    expect(links).toEqual(['https://speedwear.es/checkouts/1?a=1&b=2', 'https://speedwear.es/?utm_source=speedwear_mail&utm_medium=email']);
    expect(html).toContain('Hola &lt;b&gt;Ana&lt;/b&gt;,');
    expect(html).toContain('href="https://api.speedwear.es/c/0"');
    expect(html).toContain('href="mailto:info@speedwear.es"');
    expect(html).toContain('href="https://api.speedwear.es/u/1"');
    expect(html).toContain('Calle 1');
    expect(html).toContain('src="https://api.speedwear.es/o/1"');
    // Click lookup renders without send options and must resolve the same links.
    expect(renderEmail(payload, { firstName: 'Ana' }).links).toEqual(links);
    expect(renderEmail(payload, {}).html).toContain('Hola Ey,');
  });
});

describe('MarketingService flow conditions and package import', () => {
  it('omite un paso cuya condición no se cumple', async () => {
    const marketingEvent = { count: vi.fn().mockResolvedValue(1) };
    const message = { id: 'm1', kind: 'MARKETING', contactId: 'c1', trackingToken: 't', payload: { subject: 'Gracias', preheader: '', blocks: [{ type: 'text', text: 'x' }], eventId: 'ev1', eventAt: '2026-10-01T00:00:00Z', onlyIf: { event: 'Placed Order', op: 'gt', value: 1, since: 'all' } }, contact: { id: 'c1', email: 'ana@example.com', status: 'SUBSCRIBED', unsubscribeToken: 'u' }, campaign: null, flow: { status: 'LIVE' } };
    const marketingMessage = { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue(message), update: vi.fn() };
    const { service } = serviceWith({ marketingEvent, marketingMessage });
    const transport = { sendMail: vi.fn() };
    await (service as any).deliver('m1', transport);
    expect(marketingEvent.count).toHaveBeenCalledWith({ where: { contactId: 'c1', name: 'Placed Order' } });
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(marketingMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'SKIPPED', error: 'No cumple la condición del paso.' } });
  });

  it('importa plantillas y automatizaciones de Klaviyo en borrador', async () => {
    const marketingTemplate = { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'tpl-1' }) };
    const marketingFlow = { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() };
    const { service } = serviceWith({ marketingTemplate, marketingFlow });
    const result = await service.importPackage({
      templates: [{ key: 'RW7ATv', name: 'Carrito 1', subject: '¿Vas a dejar al Nano así, {{ first_name|default:"crack" }}?', html: '<html><body>Hola</body></html>' }],
      flows: [{ name: 'Carrito abandonado', trigger: 'Started Checkout', stopOnEvent: 'Placed Order', reentryDays: 5, steps: [{ delayMinutes: 45, templateKey: 'RW7ATv', onlyIf: { event: 'Placed Order', op: 'eq', value: 0, since: 'flow' } }, { delayMinutes: 60, templateKey: 'missing' }] }]
    });
    expect(result).toMatchObject({ templates: 1, flows: 1 });
    expect(marketingTemplate.create.mock.calls[0][0].data).toMatchObject({ subject: '¿Vas a dejar al Nano así, {{firstName|crack}}?', blocks: [{ type: 'html', text: '<html><body>Hola</body></html>' }] });
    expect(marketingFlow.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Carrito abandonado', trigger: 'Started Checkout', stopOnEvent: 'Placed Order', reentryDays: 5, steps: [{ delayMinutes: 45, templateId: 'tpl-1', onlyIf: { event: 'Placed Order', op: 'eq', value: 0, since: 'flow' } }] }) });
  });
});

describe('Klaviyo conditionals', () => {
  it('evalúa if/elif/else de Klaviyo al enviar y conserva los enlaces del producto', () => {
    const source = `{% if person.first_name %}Hola {{ person.first_name }}{% else %}Hola{% endif %}. {% if event.TrackingNumber %}Seguimiento {{ event.TrackingNumber }}{% endif %}
{% with p=event|lookup:'Price'|default:event|lookup:'Value' %}{% if p and p != 'None' %}Precio {% currency_format p %}{% endif %}{% endwith %}
<a href="{{ event|lookup:'URL'|default:'https://speedwear.es' }}">Ver</a> {% if event|lookup:'Value' %}V{% elif event|lookup:'Price' %}P{% else %}-{% endif %}`;
    const { html, warnings } = fromKlaviyo(source);
    expect(warnings).toEqual([]);
    const render = (contact: object, event: Record<string, unknown>) => renderEmail({ subject: 's', preheader: '', blocks: [{ type: 'html', text: html }], event }, contact);
    const full = render({ firstName: 'Ana' }, { TrackingNumber: 'X1', price: '39.90', url: 'https://speedwear.es/products/a' });
    expect(full.html).toContain('Hola Ana. Seguimiento X1');
    expect(full.html).toContain('Precio 39.90 €');
    expect(full.html).toContain('href="https://speedwear.es/products/a"');
    expect(full.html).toContain('>Ver</a> V');
    const empty = render({}, {});
    expect(empty.html).toContain('Hola. \n');
    expect(empty.html).not.toContain('Precio');
    expect(empty.html).toContain('href="https://speedwear.es/"');
    expect(empty.html).toContain('>Ver</a> -');
  });
});
