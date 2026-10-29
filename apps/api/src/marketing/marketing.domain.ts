import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type Block = { type: 'heading' | 'text' | 'button' | 'image' | 'divider'; text?: string; url?: string };
export type Rule =
  | { field: 'tag' | 'country' | 'email'; operator: 'is' | 'contains' | 'is_not'; value: string }
  | { field: 'event'; operator: 'in_last_days' | 'not_in_last_days'; value: string; days: number }
  | { field: 'opened' | 'clicked' | 'created'; operator: 'in_last_days' | 'not_in_last_days'; value?: string; days: number };
export type Rules = { mode: 'all' | 'any'; conditions: Rule[] };
export type Step = { delayMinutes: number; templateId: string };
export const maxStepDelayMinutes = 180 * 24 * 60;
export type MessagePayload = { subject: string; preheader: string; blocks: Block[]; event?: Record<string, unknown>; eventId?: string; eventAt?: string; stopOnEvent?: string | null };
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
  return value.map(b => {
    if (!b || !['heading', 'text', 'image', 'button', 'divider'].includes(b.type)) throw new BadRequestException('Bloque inválido.');
    const result: Block = { type: b.type, text: string(b.text, 'Texto', 10000, true), url: string(b.url, 'URL', 2000, true) };
    if (['image', 'button'].includes(b.type) && !safeUrl(result.url ?? '') && !/^\{\{\s*event\.[a-zA-Z0-9_]+\s*\}\}$/.test(result.url ?? '')) throw new BadRequestException('Las imágenes y botones requieren una URL https.');
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
    return { delayMinutes: v.delayMinutes, templateId: string(v.templateId, 'Plantilla', 100) };
  });
}
export const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function safeUrl(url: string) { try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : ''; } catch { return ''; } }
export function personalize(text: string, contact: { firstName?: string; lastName?: string; email?: string }, event: Record<string, unknown> = {}) {
  return text.replace(/\{\{\s*(firstName|lastName|email|event\.[a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = key.startsWith('event.') ? event[key.slice(6)] : contact[key as keyof typeof contact];
    return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 2000) : '';
  });
}
export function renderEmail(payload: MessagePayload, contact: { firstName?: string; lastName?: string; email?: string }, options: { unsubscribeUrl?: string; pixelUrl?: string; address?: string; trackLink?: (url: string, index: number) => string } = {}) {
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
