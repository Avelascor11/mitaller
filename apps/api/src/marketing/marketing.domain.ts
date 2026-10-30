import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// An 'html' block carries a full email document (imported Klaviyo templates); it is rendered as-is instead of inside our layout.
export type Block = { type: 'heading' | 'text' | 'button' | 'image' | 'divider' | 'html'; text?: string; url?: string };
export type Rule =
  | { field: 'tag' | 'country' | 'email'; operator: 'is' | 'contains' | 'is_not'; value: string }
  | { field: 'event'; operator: 'in_last_days' | 'not_in_last_days'; value: string; days: number }
  | { field: 'opened' | 'clicked' | 'created'; operator: 'in_last_days' | 'not_in_last_days'; value?: string; days: number };
export type Rules = { mode: 'all' | 'any'; conditions: Rule[] };
/** Evaluated when the step is about to send: e.g. "only if no Placed Order since the flow started". */
export type StepCondition = { event: string; op: 'eq' | 'gt'; value: number; since: 'flow' | 'all' | 'days'; days?: number };
export type Step = { delayMinutes: number; templateId: string; onlyIf?: StepCondition };
export const maxStepDelayMinutes = 180 * 24 * 60;
export type MessagePayload = { subject: string; preheader: string; blocks: Block[]; event?: Record<string, unknown>; eventId?: string; eventAt?: string; stopOnEvent?: string | null; onlyIf?: StepCondition };
export const htmlBlockMax = 400000;
export const contactFields = { id: true, email: true, firstName: true, lastName: true, country: true, tags: true, status: true, consentAt: true, consentSource: true, createdAt: true } as const;
export function string(value: unknown, label: string, max = 200, optional = false) {
  if (value == null && optional) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw new BadRequestException(`${label}: valor inválido (máximo ${max} caracteres).`);
  return value.trim();
}
export function email(value: unknown) {
  const result = string(value, 'Email', 254).toLowerCase();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(result)) throw new BadRequestException('Email inválido.');
  return result;
}
export function blocks(value: unknown): Block[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) throw new BadRequestException('Añade entre 1 y 40 bloques.');
  if (value.some(b => b?.type === 'html') && value.length > 1) throw new BadRequestException('Un email en HTML va en un único bloque.');
  return value.map(b => {
    if (!b || !['heading', 'text', 'image', 'button', 'divider', 'html'].includes(b.type)) throw new BadRequestException('Bloque inválido.');
    if (b.type === 'html') return { type: 'html', text: string(b.text, 'HTML', htmlBlockMax) };
    const result: Block = { type: b.type, text: string(b.text, 'Texto', 10000, true), url: string(b.url, 'URL', 2000, true) };
    if (['image', 'button'].includes(b.type) && !safeUrl(result.url ?? '') && !/^\{\{\s*event(\.[a-zA-Z0-9_$]+)+\s*\}\}$/.test(result.url ?? '')) throw new BadRequestException('Las imágenes y botones requieren una URL https.');
    return result;
  });
}
export function rules(value: unknown): Rules {
  const v = value as Rules;
  if (!v || !['all', 'any'].includes(v.mode) || !Array.isArray(v.conditions) || v.conditions.length > 12) throw new BadRequestException('Segmento inválido.');
  return { mode: v.mode, conditions: v.conditions.map((c): Rule => {
    if (c && ['event', 'opened', 'clicked', 'created'].includes(c.field)) {
      const days = (c as { days?: unknown }).days;
      if (!['in_last_days', 'not_in_last_days'].includes(c.operator) || !Number.isInteger(days) || (days as number) < 1 || (days as number) > 3650) throw new BadRequestException('Condición de actividad inválida: indica días entre 1 y 3650.');
      if (c.field === 'event') return { field: 'event', operator: c.operator as 'in_last_days', value: string(c.value, 'Evento', 100), days: days as number };
      return { field: c.field as 'opened', operator: c.operator as 'in_last_days', days: days as number };
    }
    if (!c || !['tag', 'country', 'email'].includes(c.field) || !['is', 'is_not', 'contains'].includes(c.operator)) throw new BadRequestException('Condición de segmento inválida.');
    if (c.field === 'tag' && c.operator === 'contains') throw new BadRequestException('Las etiquetas se comparan con es/no es.');
    return { field: c.field as 'tag', operator: c.operator as 'is', value: string(c.value, 'Valor', 100) };
  }) };
}
export function audienceWhere(input?: Rules | null, now = new Date()): Prisma.MarketingContactWhereInput {
  const r = input ? rules(input) : { mode: 'all', conditions: [] };
  const conditions: Prisma.MarketingContactWhereInput[] = r.conditions.map(c => {
    if (c.operator === 'in_last_days' || c.operator === 'not_in_last_days') {
      const since = new Date(now.getTime() - c.days * 86400000);
      const recent = c.operator === 'in_last_days';
      if (c.field === 'created') return { createdAt: recent ? { gte: since } : { lt: since } };
      if (c.field === 'event') return { events: { [recent ? 'some' : 'none']: { name: c.value, createdAt: { gte: since } } } };
      return { messages: { [recent ? 'some' : 'none']: { [c.field === 'opened' ? 'openedAt' : 'clickedAt']: { gte: since } } } };
    }
    const filter = c.field === 'tag' ? { tags: { has: c.value } } : { [c.field]: { [c.operator === 'contains' ? 'contains' : 'equals']: c.value, mode: 'insensitive' } };
    return c.operator === 'is_not' ? { NOT: filter } : filter;
  });
  return { status: 'SUBSCRIBED', ...(conditions.length ? { [r.mode === 'any' ? 'OR' : 'AND']: conditions } : {}) };
}
export function steps(value: unknown): Step[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new BadRequestException('Una automatización necesita entre 1 y 20 pasos.');
  return value.map(v => {
    if (!Number.isInteger(v.delayMinutes) || v.delayMinutes < 0 || v.delayMinutes > maxStepDelayMinutes) throw new BadRequestException(`Espera inválida: entre 0 y ${maxStepDelayMinutes} minutos (180 días).`);
    const step: Step = { delayMinutes: v.delayMinutes, templateId: string(v.templateId, 'Plantilla', 100) };
    if (v.onlyIf) step.onlyIf = condition(v.onlyIf);
    return step;
  });
}
export function condition(v: any): StepCondition {
  if (!v || !['eq', 'gt'].includes(v.op) || !Number.isInteger(v.value) || v.value < 0 || v.value > 1000 || !['flow', 'all', 'days'].includes(v.since)) throw new BadRequestException('Condición del paso inválida.');
  if (v.since === 'days' && (!Number.isInteger(v.days) || v.days < 1 || v.days > 3650)) throw new BadRequestException('Condición del paso: días entre 1 y 3650.');
  return { event: string(v.event, 'Evento de la condición', 100), op: v.op, value: v.value, since: v.since, ...(v.since === 'days' ? { days: v.days } : {}) };
}
/** Comma-separated exit events ("Placed Order, Started Checkout"). */
export const stopEvents = (v?: string | null) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
export const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function safeUrl(url: string) { try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : ''; } catch { return ''; } }
type Vars = { unsubscribeUrl?: string; address?: string };
const TOKEN = /\{\{\s*(firstName|lastName|email|unsubscribeUrl|address|event(?:\.[a-zA-Z0-9_$]+)+)\s*(?:\|([^{}]{0,200}))?\}\}/g;
const COND = /\{\{(#if|#elif)\s*(!?)\s*([a-zA-Z0-9_$.]*)\s*\}\}|\{\{#else\}\}|\{\{\/if\}\}/g;
/** {{#if event.x}}…{{#elif firstName}}…{{#else}}…{{/if}} (nestable); an empty condition is always true. */
function applyConditionals(text: string, truthy: (path: string) => boolean): string {
  let out = '', last = 0, depth = 0, blockStart = 0;
  let branches: { test: () => boolean; start: number; end: number }[] = [];
  const test = (neg: string, path: string) => () => !path || truthy(path) !== Boolean(neg);
  for (const m of text.matchAll(COND)) {
    const [tag, kind, neg, path] = m, at = m.index!;
    if (kind === '#if') {
      if (depth++ === 0) { out += text.slice(last, at); blockStart = at; branches = [{ test: test(neg, path), start: at + tag.length, end: -1 }]; }
    } else if (depth === 1 && (kind === '#elif' || tag === '{{#else}}')) {
      branches[branches.length - 1].end = at;
      branches.push({ test: kind ? test(neg, path) : () => true, start: at + tag.length, end: -1 });
    } else if (tag === '{{/if}}' && depth > 0 && --depth === 0) {
      branches[branches.length - 1].end = at;
      const hit = branches.find(b => b.test());
      if (hit) out += applyConditionals(text.slice(hit.start, hit.end), truthy);
      last = at + tag.length;
    }
  }
  // An unclosed block keeps its content without the condition markers.
  return out + (depth > 0 ? text.slice(blockStart).replace(COND, '') : text.slice(last));
}
/** Replaces {{firstName}}, {{event.a.b}}, {{unsubscribeUrl}}… A "|text" suffix is the fallback when the value is empty. */
export function personalize(text: string, contact: { firstName?: string; lastName?: string; email?: string }, event: Record<string, unknown> = {}, vars: Vars = {}, escape = false) {
  const lookup = (key: string): unknown => key.startsWith('event.') ? key.slice(6).split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), event)
    : key === 'unsubscribeUrl' || key === 'address' ? vars[key] : contact[key as keyof typeof contact];
  if (text.includes('{{#if')) text = applyConditionals(text, path => { const v = lookup(path); return v != null && v !== '' && v !== 'None' && v !== false && !(Array.isArray(v) && !v.length); });
  return text.replace(TOKEN, (_, key: string, fallback?: string) => {
    const value = lookup(key);
    const out = (typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 2000) : '') || (fallback ?? '').trim();
    return escape ? escapeHtml(out) : out;
  });
}
const decode = (v: string) => v.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
function renderHtmlDocument(source: string, payload: MessagePayload, contact: { firstName?: string; lastName?: string; email?: string }, options: { unsubscribeUrl?: string; pixelUrl?: string; address?: string; trackLink?: (url: string, index: number) => string }) {
  const links: string[] = [];
  let html = personalize(source, contact, payload.event, { unsubscribeUrl: options.unsubscribeUrl ?? '#', address: options.address ?? '' }, true);
  // Same order on send and on click lookup; the unsubscribe link is never rewritten.
  html = html.replace(/href\s*=\s*(["'])(.*?)\1/gi, (match, quote: string, raw: string) => {
    const target = decode(raw.trim());
    const url = safeUrl(target);
    if (!url || (options.unsubscribeUrl && target === options.unsubscribeUrl)) return match;
    const i = links.push(url) - 1;
    return `href=${quote}${escapeHtml(options.trackLink?.(url, i) ?? url)}${quote}`;
  });
  const footer = [
    options.address && !html.includes(escapeHtml(options.address)) ? escapeHtml(options.address) : '',
    options.unsubscribeUrl && !html.includes(escapeHtml(options.unsubscribeUrl)) ? `<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#888">Cancelar suscripción</a>` : ''
  ].filter(Boolean).join('<br>');
  const tail = `${footer ? `<div style="text-align:center;font:12px/1.6 Arial,sans-serif;color:#888;padding:16px">${footer}</div>` : ''}${options.pixelUrl ? `<img alt="" width="1" height="1" src="${escapeHtml(options.pixelUrl)}">` : ''}`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tail}</body>`) : html + tail;
  const text = decode(html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  return { html, links, text: text + (links.length ? `\n\n${links.join('\n')}` : '') + (options.unsubscribeUrl ? `\n\nCancelar suscripción: ${options.unsubscribeUrl}` : '') };
}
export function renderEmail(payload: MessagePayload, contact: { firstName?: string; lastName?: string; email?: string }, options: { unsubscribeUrl?: string; pixelUrl?: string; address?: string; trackLink?: (url: string, index: number) => string } = {}) {
  if (payload.blocks.length === 1 && payload.blocks[0].type === 'html') return renderHtmlDocument(payload.blocks[0].text ?? '', payload, contact, options);
  const links: string[] = [];
  const text = (v = '') => personalize(v, contact, payload.event);
  const body = payload.blocks.map(b => {
    const content = escapeHtml(text(b.text)).replace(/\n/g, '<br>');
    const url = safeUrl(text(b.url));
    switch (b.type) {
      case 'heading': return `<h1 style="font:700 32px/1.15 Arial;color:#202320;margin:24px 0">${content}</h1>`;
      case 'text': return `<p style="font:16px/1.7 Arial;color:#495048;margin:20px 0">${content}</p>`;
      case 'image': return url ? `<img alt="${escapeHtml(text(b.text))}" src="${escapeHtml(url)}" style="display:block;width:100%;border-radius:12px">` : '';
      case 'divider': return '<hr style="border:0;border-top:1px solid #e4e8df;margin:28px 0">';
      case 'html': return '';
      case 'button': {
        if (!url) return '';
        const i = links.push(url) - 1;
        return `<p style="margin:28px 0"><a href="${escapeHtml(options.trackLink?.(url, i) ?? url)}" style="display:inline-block;background:#bcea65;color:#202320;padding:16px 26px;border-radius:8px;text-decoration:none;font:700 15px Arial">${content}</a></p>`;
      }
    }
  }).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f5f0;padding:30px 12px"><span style="display:none;max-height:0;overflow:hidden">${escapeHtml(text(payload.preheader))}</span><div style="max-width:600px;margin:auto;background:white;padding:36px;border-radius:16px"><div style="font:800 14px Arial;letter-spacing:3px">SPEEDWEAR</div>${body}<hr style="border:0;border-top:1px solid #e4e8df;margin-top:32px"><p style="font:12px/1.6 Arial;color:#73796f">${escapeHtml(options.address ?? 'Vista previa · Speedwear Mail')}${options.unsubscribeUrl ? `<br><a style="color:#73796f" href="${escapeHtml(options.unsubscribeUrl)}">Cancelar suscripción</a>` : ''}</p></div>${options.pixelUrl ? `<img alt="" width="1" height="1" src="${escapeHtml(options.pixelUrl)}">` : ''}</body></html>`;
  return { html, links, text: payload.blocks.map(b => text(b.text) + (b.url ? '\n' + safeUrl(text(b.url)) : '')).join('\n\n') + (options.unsubscribeUrl ? '\n\nCancelar suscripción: ' + options.unsubscribeUrl : '') };
}

const klaviyoEventPaths: Record<string, string> = {
  'extra.checkout_url': 'checkoutUrl', 'extra.responsive_checkout_url': 'checkoutUrl', 'extra.order_number': 'orderNumber', 'extra.order_status_url': 'orderStatusUrl', 'extra.line_items': 'itemsText',
  '$value': 'total', 'extra.total_price': 'total', 'extra.subtotal_price': 'total', 'URL': 'url', 'ProductName': 'title', 'Name': 'title', 'Title': 'title', 'ImageURL': 'image', 'Price': 'price', 'Value': 'price'
};
const klaviyoPath = (raw: string) => {
  const p = raw.replace(/^person\./, '');
  if (['first_name', 'last_name', 'email'].includes(p)) return ({ first_name: 'firstName', last_name: 'lastName', email: 'email' } as Record<string, string>)[p];
  return raw.startsWith('event.') ? `event.${klaviyoEventPaths[raw.slice(6)] ?? raw.slice(6)}` : '';
};
/** Converts Klaviyo's Django-style tags to Speedwear Mail tokens. Returns the warnings for constructs that could not be kept. */
export function fromKlaviyo(source: string) {
  const warnings = new Set<string>();
  const fallback = (filters = '') => /default:\s*(['"])(.*?)\1/.exec(filters)?.[2] ?? '';
  const token = (name: string, filters = '') => `{{${name}${fallback(filters) ? `|${fallback(filters)}` : ''}}}`;
  // event|lookup:'Key' → event.Key (keys with spaces stay as they are and are dropped later).
  let out = source.replace(/\b(event|person)\|lookup:\s*(['"])([A-Za-z0-9_$]+)\2/g, '$1.$3');
  // {% with p=event.Price|default:… %}…{% endwith %}: inline the variable as its first path.
  out = out.replace(/\{%\s*with\s+(\w+)\s*=\s*([a-zA-Z0-9_$.]+)[^%]*%\}([\s\S]*?)\{%\s*endwith\s*%\}/g, (_, name: string, path: string, body: string) =>
    body.replace(/\{[{%][\s\S]*?[}%]\}/g, tag => tag.replace(new RegExp(`\\b${name}\\b`, 'g'), path)));
  out = out
    .replace(/\{%\s*currency_format\s+([a-zA-Z0-9_$.]+)\s*%\}/g, '{{ $1 }} €')
    .replace(/\{%\s*(if|elif)\s+([^%]*?)%\}/g, (_, kind: string, expr: string) => {
      const neg = /^\s*not\s/.test(expr);
      const path = klaviyoPath(/(event\.[a-zA-Z0-9_$.]+|person\.[a-z_]+|first_name|last_name)/.exec(expr)?.[1] ?? '');
      if (!path) warnings.add(`Condición de Klaviyo no reconocida (se muestra siempre): ${expr.trim().slice(0, 50)}`);
      return `{{#${kind} ${neg ? '!' : ''}${path}}}`;
    })
    .replace(/\{%\s*else\s*%\}/g, '{{#else}}').replace(/\{%\s*endif\s*%\}/g, '{{/if}}')
    .replace(/\{\{\s*organization\.url\s*(\|[^}]*)?\}\}/g, 'https://speedwear.es');
  out = out
    .replace(/\{%\s*unsubscribe\s*(?:(['"])(.*?)\1)?\s*%\}/g, (_, _q, label) => `<a href="{{unsubscribeUrl}}" style="color:inherit">${escapeHtml(label || 'Cancelar suscripción')}</a>`)
    .replace(/\{%\s*(unsubscribe_url|unsubscribe_link|manage_preferences(?:_url|_link)?)\s*%\}|\{\{\s*unsubscribe_url\s*\}\}/g, '{{unsubscribeUrl}}')
    .replace(/\{%\s*(web_view|view_in_browser)(?:_url|_link)?\s*%\}/g, 'https://speedwear.es')
    .replace(/\{\{\s*organization\.name\s*(\|[^}]*)?\}\}/g, 'SpeedWear')
    .replace(/\{\{\s*organization\.(full_address|address)\s*(\|[^}]*)?\}\}/g, '{{address}}')
    .replace(/\{\{\s*(?:person\.|person\|lookup:['"])?(first_name|last_name|email)['"]?\s*((?:\|[^}]*)?)\}\}/g, (_, key: string, filters: string) => token(({ first_name: 'firstName', last_name: 'lastName', email: 'email' } as Record<string, string>)[key], filters))
    .replace(/\{%\s*for\s+\w+\s+in\s+event\.extra\.line_items[^%]*%\}[\s\S]*?\{%\s*endfor\s*%\}/g, () => { warnings.add('Lista de productos sustituida por un resumen ({{event.itemsText}}).'); return '<p>{{event.itemsText}}</p>'; })
    .replace(/\{\{\s*event\.([a-zA-Z0-9_$.]+)\s*((?:\|[^}]*)?)\}\}/g, (_, path: string, filters: string) => token(`event.${klaviyoEventPaths[path] ?? path}`, filters))
    .replace(/utm_source=klaviyo/g, 'utm_source=speedwear_mail');
  out = out.replace(/\{%[\s\S]*?%\}/g, tag => { warnings.add(`Etiqueta de Klaviyo eliminada: ${tag.slice(0, 60)}`); return ''; });
  out = out.replace(/\{\{(?!\s*(firstName|lastName|email|unsubscribeUrl|address|event\.|#if|#elif|#else|\/if))[\s\S]*?\}\}/g, tag => { warnings.add(`Variable de Klaviyo eliminada: ${tag.slice(0, 60)}`); return ''; });
  return { html: out, warnings: [...warnings] };
}
