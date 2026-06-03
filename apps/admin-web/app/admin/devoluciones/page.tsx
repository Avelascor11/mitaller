'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const ACCENT = '#34B27B';
const ACCENT2 = '#2A9D8F';
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif";

const STATUS_META: Record<string, { label: string; fg: string; bg: string; dot: string }> = {
  REQUESTED:     { label: 'En espera',        fg: '#f0b429', bg: 'rgba(240,180,41,0.12)',  dot: '#f0b429' },
  LABEL_CREATED: { label: 'Etiqueta enviada', fg: '#5b9bd5', bg: 'rgba(91,155,213,0.12)',  dot: '#5b9bd5' },
  RECEIVED:      { label: 'Por revisar',      fg: '#9b8cdb', bg: 'rgba(155,140,219,0.12)', dot: '#9b8cdb' },
  APPROVED:      { label: 'Aprobada',         fg: '#3fb98a', bg: 'rgba(63,185,138,0.12)',  dot: '#3fb98a' },
  REJECTED:      { label: 'Rechazada',        fg: '#e06a6a', bg: 'rgba(224,106,106,0.12)', dot: '#e06a6a' },
  CANCELLED:     { label: 'Cancelada',        fg: '#8A8A96', bg: 'rgba(138,138,150,0.12)', dot: '#8A8A96' },
};

const EXCEPTION_LABELS: Record<string, { label: string; color: string }> = {
  EXTEND_WINDOW:  { label: 'Ampliar plazo',   color: '#5b9bd5' },
  FREE_LABEL:     { label: 'Etiqueta gratis',  color: '#3fb98a' },
  ACCEPT_EXPIRED: { label: 'Aceptar expirado', color: '#f0b429' },
  BLOCK:          { label: 'Bloqueado',        color: '#e06a6a' },
};

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  WRONG_SIZE:       { label: 'Talla incorrecta',   color: '#5b9bd5' },
  DEFECTIVE:        { label: 'Defectuoso',          color: '#e06a6a' },
  NOT_AS_DESCRIBED: { label: 'No como esperaba',    color: '#9b8cdb' },
  CHANGED_MIND:     { label: 'Cambio de opinión',   color: '#f0b429' },
  WRONG_ITEM:       { label: 'Artículo incorrecto', color: '#e0995a' },
  OTHER:            { label: 'Otro',                color: '#8A8A96' },
};

const AV = ['#34B27B', '#5b9bd5', '#9b8cdb', '#e0995a', '#e06a6a'];
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function makeTheme(dark: boolean) {
  return dark
    ? { dark: true, text: '#ECECEF', text2: '#B4B4BE', dim: '#7C7C88', faint: '#56565F', card: 'rgba(255,255,255,0.025)', cardSolid: '#16161C', drawer: '#101015', border: 'rgba(255,255,255,0.08)', borderSoft: 'rgba(255,255,255,0.05)', side: 'rgba(255,255,255,0.015)', head: 'rgba(255,255,255,0.02)', hover: 'rgba(255,255,255,0.03)', inputBg: 'rgba(255,255,255,0.04)', bgBase: '#08080B', shadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 48px -16px rgba(0,0,0,0.65)' }
    : { dark: false, text: '#15171C', text2: '#3C4049', dim: '#6B7280', faint: '#9AA0AA', card: 'rgba(255,255,255,0.9)', cardSolid: '#FFFFFF', drawer: '#FFFFFF', border: 'rgba(20,22,28,0.08)', borderSoft: 'rgba(20,22,28,0.05)', side: 'rgba(255,255,255,0.6)', head: 'rgba(20,22,28,0.02)', hover: 'rgba(20,22,28,0.025)', inputBg: '#FFFFFF', bgBase: '#EEF0F3', shadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 40px -16px rgba(20,22,28,0.16)' };
}

function Icon({ d, size = 17, c, sw = 1.8 }: { d: string; size?: number; c: string; sw?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d.split('|').map((p, i) => <path key={i} d={p} />)}</svg>;
}
const ICONS = {
  returns: 'M3 7h13a4 4 0 0 1 0 8H8|M8 11l-4 4 4 4',
  config:  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z|M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  brand:   'M12 3l2.09 4.26L19 8l-3.5 3.4.83 4.85L12 13.9l-4.33 2.35L8.5 11.4 5 8l4.91-.74Z',
  exc:     'M12 9v4|M12 17h.01|M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z',
  search:  'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|M21 21l-4.3-4.3',
  refresh: 'M23 4v6h-6|M1 20v-6h6|M3.51 9a9 9 0 0 1 14.85-3.36L23 10|M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  logout:  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9',
};

function Spark({ data, color }: { data: number[]; color: string }) {
  const d2 = data.length < 2 ? [...data, ...data] : data;
  const w = 60, h = 20, max = Math.max(...d2), min = Math.min(...d2);
  const pts = d2.map((v, i) => [(i / (d2.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 4) - 2]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return <svg width={w} height={h} style={{ display: 'block' }}><path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /><circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r={2} fill={color} /></svg>;
}

function AreaChart({ data, color, dark }: { data: number[]; color: string; dark: boolean }) {
  const s = data.length >= 2 ? data : [0, 0];
  const w = 560, h = 120, pad = 6, max = Math.max(...s, 1);
  const x = (i: number) => pad + (i / (s.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2 - 8);
  const line = s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(s.length-1).toFixed(1)} ${h-pad} L${x(0).toFixed(1)} ${h-pad} Z`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={dark ? 0.34 : 0.26} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      {[0.33, 0.66].map(g => <line key={g} x1={pad} x2={w-pad} y1={h*g} y2={h*g} stroke={dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,22,28,0.05)'} strokeWidth={1} />)}
      <path d={area} fill="url(#ag)" />
      <path className="ad-chartline" d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(s.length-1)} cy={y(s[s.length-1])} r={3.5} fill={color} stroke={dark ? '#0b0b0f' : '#fff'} strokeWidth={2} />
    </svg>
  );
}

function Donut({ segments, total, dark }: { segments: { value: number; color: string }[]; total: number; dark: boolean }) {
  const r = 42, C = 2 * Math.PI * r; let off = 0;
  return (
    <svg className="ad-donut" width={108} height={108} viewBox="0 0 108 108">
      <g transform="translate(54,54) rotate(-90)">
        <circle r={r} fill="none" stroke={dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,22,28,0.05)'} strokeWidth={11} />
        {total > 0 && segments.map((s, i) => { const len = (s.value/total)*C; const el = <circle key={i} r={r} fill="none" stroke={s.color} strokeWidth={11} strokeDasharray={`${len} ${C-len}`} strokeDashoffset={-off} strokeLinecap="round" />; off += len; return el; })}
      </g>
      <text x={54} y={50} textAnchor="middle" fontSize={20} fontWeight={750} fill={dark ? '#ECECEF' : '#15171C'}>{total}</text>
      <text x={54} y={66} textAnchor="middle" fontSize={9.5} fill={dark ? '#7C7C88' : '#9AA0AA'}>artículos</text>
    </svg>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; ok: boolean }[]>([]);
  const ctr = useRef(0);
  const push = (msg: string, ok2 = true) => { const id = ++ctr.current; setToasts(t => [...t, { id, msg, ok: ok2 }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500); };
  return { toasts, ok: (m: string) => push(m, true), err: (m: string) => push(m, false) };
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime(), m = Math.floor(diff / 60000);
  if (m < 2) return 'Ahora mismo'; if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24); if (d < 30) return `Hace ${d} d`;
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

type Tab = 'list' | 'config' | 'branding' | 'exceptions';

// Framer variants
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const tabVariants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeIn' as const } },
};

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.05 } },
};

const cardItem = {
  initial: { opacity: 0, y: 18, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: EASE } },
};

const rowItem = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.26, ease: EASE } },
};

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.15 } },
};

const drawerVariants = {
  initial: { opacity: 0, scale: 0.93, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring' as const, damping: 22, stiffness: 320 } },
  exit:    { opacity: 0, scale: 0.95, y: 8, transition: { duration: 0.15, ease: 'easeIn' as const } },
};

export default function AdminDevolucionesPage() {
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState<Tab>('list');
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { toasts, ok, err } = useToast();
  const [returns, setReturns] = useState<any[]>([]);
  const [filterStatus, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'status'>('date');
  const [config, setConfig] = useState<any>(null);
  const [configDraft, setDraft] = useState<any>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [portalCfg, setPortalCfg] = useState<any>(null);
  const [portalDraft, setPortalDraft] = useState<any>(null);
  const [savingPortal, setSavingPortal] = useState(false);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [showNewEx, setShowNewEx] = useState(false);
  const [newEx, setNewEx] = useState<{ orderNumber: string; customerEmail: string; extraDays: number; notes: string; expiresAt: string; opts: Record<string, boolean> }>({ orderNumber: '', customerEmail: '', extraDays: 7, notes: '', expiresAt: '', opts: { EXTEND_WINDOW: false, FREE_LABEL: true, ACCEPT_EXPIRED: false, BLOCK: false } });

  const t = makeTheme(dark);

  useEffect(() => {
    const storedTheme = localStorage.getItem('admin-theme');
    if (storedTheme) setDark(storedTheme === 'dark');
    const stored = localStorage.getItem('token') || localStorage.getItem('mitaller_token');
    if (stored) { setToken(stored); loadAll(stored, 'list'); }
    else { window.location.href = '/login'; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { localStorage.setItem('admin-theme', dark ? 'dark' : 'light'); }, [dark]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (token) loadAll(token, tab); }, [tab]);

  function auth(tk: string) { return { Authorization: `Bearer ${tk}` }; }
  function logout() { ['token', 'mitaller_token'].forEach(k => localStorage.removeItem(k)); document.cookie = 'admin-token=; path=/; max-age=0'; window.location.href = '/login'; }

  async function loadAll(jwt: string, t2: Tab) {
    setLoading(true);
    try {
      if (t2 === 'list') { const r = await fetch(`${API}/returns`, { headers: auth(jwt) }); if (r.status === 401) { logout(); return; } if (r.ok) setReturns(await r.json()); }
      else if (t2 === 'config') { const r = await fetch(`${API}/returns/admin/config`, { headers: auth(jwt) }); if (r.status === 401) { logout(); return; } if (r.ok) { const c = await r.json(); setConfig(c); setDraft(c); } }
      else if (t2 === 'exceptions') { const r = await fetch(`${API}/returns/admin/exceptions`, { headers: auth(jwt) }); if (r.status === 401) { logout(); return; } if (r.ok) setExceptions(await r.json()); }
      else if (t2 === 'branding') { const r = await fetch(`${API}/portal-config`, { headers: auth(jwt) }); if (r.status === 401) { logout(); return; } if (r.ok) { const c = await r.json(); setPortalCfg(c); setPortalDraft(c); } }
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  async function saveConfig() {
    if (!configDraft) return; setSavingConfig(true);
    try { const r = await fetch(`${API}/returns/admin/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(configDraft) }); if (r.ok) { const c = await r.json(); setConfig(c); setDraft(c); ok('Guardado ✓'); } else err('Error guardando'); } catch { err('Error'); } finally { setSavingConfig(false); }
  }

  async function saveBranding() {
    if (!portalDraft) return; setSavingPortal(true);
    try { const r = await fetch(`${API}/portal-config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(portalDraft) }); if (r.ok) { const c = await r.json(); setPortalCfg(c); setPortalDraft(c); ok('Guardado ✓'); } else err('Error guardando'); } catch { err('Error'); } finally { setSavingPortal(false); }
  }

  async function postRule(body: Record<string, unknown>) {
    const r = await fetch(`${API}/returns/admin/exceptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(body) });
    return r.ok;
  }

  // Create a group: one row per selected option
  async function createException() {
    if (!newEx.orderNumber && !newEx.customerEmail) { err('Indica pedido o email'); return; }
    const selected = Object.entries(newEx.opts).filter(([, v]) => v).map(([k]) => k);
    if (selected.length === 0) { err('Selecciona al menos una opción'); return; }
    const base: Record<string, unknown> = {};
    if (newEx.orderNumber) base.orderNumber = newEx.orderNumber;
    if (newEx.customerEmail) base.customerEmail = newEx.customerEmail;
    if (newEx.notes) base.notes = newEx.notes;
    if (newEx.expiresAt) base.expiresAt = newEx.expiresAt;
    try {
      let okAll = true;
      for (const type of selected) {
        const body = { ...base, type, ...(type === 'EXTEND_WINDOW' ? { extraDays: newEx.extraDays } : {}) };
        if (!(await postRule(body))) okAll = false;
      }
      if (okAll) ok('Excepción creada ✓'); else err('Algunas opciones fallaron');
      setShowNewEx(false);
      setNewEx({ orderNumber: '', customerEmail: '', extraDays: 7, notes: '', expiresAt: '', opts: { EXTEND_WINDOW: false, FREE_LABEL: true, ACCEPT_EXPIRED: false, BLOCK: false } });
      loadAll(token, 'exceptions');
    } catch { err('Error'); }
  }

  // Add or remove a single option within an existing group
  async function addRuleToGroup(group: { orderNumber?: string | null; customerEmail?: string | null }, type: string) {
    const body: Record<string, unknown> = { type };
    if (group.orderNumber) body.orderNumber = group.orderNumber;
    if (group.customerEmail) body.customerEmail = group.customerEmail;
    if (type === 'EXTEND_WINDOW') body.extraDays = 7;
    if (await postRule(body)) { ok('Opción añadida ✓'); loadAll(token, 'exceptions'); } else err('Error');
  }

  async function removeRule(id: string) {
    await fetch(`${API}/returns/admin/exceptions/${id}`, { method: 'DELETE', headers: auth(token) });
    loadAll(token, 'exceptions');
  }

  async function setRuleDays(id: string, extraDays: number) {
    await fetch(`${API}/returns/admin/exceptions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ extraDays }) });
    loadAll(token, 'exceptions');
  }

  async function deleteGroup(ids: string[]) {
    if (!confirm('¿Borrar todas las opciones de este pedido?')) return;
    await Promise.all(ids.map((id) => fetch(`${API}/returns/admin/exceptions/${id}`, { method: 'DELETE', headers: auth(token) })));
    ok('Excepción eliminada'); loadAll(token, 'exceptions');
  }

  const now30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const kpis = {
    espera: returns.filter(r => r.status === 'REQUESTED').length,
    revisar: returns.filter(r => r.status === 'RECEIVED').length,
    refund: returns.filter(r => r.refundedAt).reduce((s: number, r: any) => s + (r.shopifyRefundAmount ?? r.refundAmount ?? 0), 0),
    trans30: returns.filter(r => new Date(r.createdAt).getTime() > now30).length,
  };

  const daily = useMemo(() => {
    const days = 14, buckets = new Array(days).fill(0), start = new Date(); start.setHours(0,0,0,0);
    const startMs = start.getTime() - (days - 1) * 86400000;
    returns.forEach(r => { const idx = Math.floor((new Date(r.createdAt).getTime() - startMs) / 86400000); if (idx >= 0 && idx < days) buckets[idx]++; });
    return buckets;
  }, [returns]);

  const reasons = useMemo(() => {
    const map: Record<string, number> = {};
    returns.forEach(r => r.items?.forEach((it: any) => { map[it.reason] = (map[it.reason] ?? 0) + it.quantity; }));
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return { entries, total: entries.reduce((s, [, v]) => s + v, 0) };
  }, [returns]);

  // Group exception rows by target (order number, else email) → one card per order/cliente
  const exceptionGroups = useMemo(() => {
    const map = new Map<string, { key: string; orderNumber?: string | null; customerEmail?: string | null; rules: Record<string, any>; ids: string[] }>();
    for (const ex of exceptions) {
      const key = (ex.orderNumber || ex.customerEmail || ex.id) as string;
      if (!map.has(key)) map.set(key, { key, orderNumber: ex.orderNumber, customerEmail: ex.customerEmail, rules: {}, ids: [] });
      const g = map.get(key)!;
      g.rules[ex.type] = ex;
      g.ids.push(ex.id);
      if (ex.orderNumber) g.orderNumber = ex.orderNumber;
      if (ex.customerEmail) g.customerEmail = ex.customerEmail;
    }
    return [...map.values()];
  }, [exceptions]);

  const stats = [
    { label: 'En espera',   value: String(kpis.espera),  accent: '#f0b429', spark: daily.slice(-7) },
    { label: 'Por revisar', value: String(kpis.revisar), accent: '#9b8cdb', spark: daily.slice(-7) },
    { label: 'Reembolsado', value: `${kpis.refund.toFixed(0)}€`, accent: '#3fb98a', spark: daily.slice(-7) },
    { label: 'Últimos 30d', value: String(kpis.trans30), accent: '#5b9bd5', spark: daily.slice(-7) },
  ];

  const filtered = returns.filter(r => {
    const ms = filterStatus === 'ALL' || r.status === filterStatus;
    const q = search.toLowerCase();
    const mq = !q || r.shopifyOrderNumber?.toLowerCase().includes(q) || r.customerName?.toLowerCase().includes(q) || r.customerEmail?.toLowerCase().includes(q);
    return ms && mq;
  }).sort((a, b) => sortBy === 'status' ? a.status.localeCompare(b.status) : new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());

  const mesh = dark
    ? `radial-gradient(900px 500px at 12% -8%, rgba(52,178,123,0.10), transparent 60%), radial-gradient(800px 600px at 100% 0%, rgba(91,120,213,0.08), transparent 55%), radial-gradient(700px 500px at 50% 120%, rgba(120,90,200,0.06), transparent 60%)`
    : `radial-gradient(900px 500px at 12% -8%, rgba(52,178,123,0.12), transparent 60%), radial-gradient(800px 600px at 100% 0%, rgba(91,120,213,0.10), transparent 55%)`;

  const inp: React.CSSProperties = { padding: '10px 13px', borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 14, color: t.text, background: t.inputBg, outline: 'none', width: '100%', fontFamily: FONT };
  const cl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13, fontWeight: 500, color: t.text2 };
  const btnP: React.CSSProperties = { padding: '11px 18px', background: `linear-gradient(140deg,${ACCENT},${ACCENT2})`, color: '#fff', border: 'none', borderRadius: 11, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, boxShadow: `0 8px 18px -8px ${ACCENT}aa` };
  const btnS: React.CSSProperties = { padding: '10px 16px', background: t.card, color: t.text2, border: `1px solid ${t.border}`, borderRadius: 11, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: FONT };

  const SIDE: Array<{ id: Tab; label: string; icon: string; badge?: number }> = [
    { id: 'list', label: 'Devoluciones', icon: ICONS.returns, badge: kpis.espera + kpis.revisar },
    { id: 'config', label: 'Configuración', icon: ICONS.config },
    { id: 'branding', label: 'Personalización', icon: ICONS.brand },
    { id: 'exceptions', label: 'Excepciones', icon: ICONS.exc },
  ];

  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bgBase, fontFamily: FONT }}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
        style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 18, padding: '36px 32px', width: '100%', maxWidth: 380, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}
      >
        <div style={{ width: 40, height: 40, borderRadius: 11, background: `linear-gradient(140deg,${ACCENT},${ACCENT2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 16 }}>S</div>
        <div style={{ fontSize: 22, fontWeight: 750, color: t.text, letterSpacing: '-0.02em' }}>Panel de devoluciones</div>
        <div style={{ fontSize: 14, color: t.dim, marginTop: 4, marginBottom: 24 }}>Speedwear Admin</div>
        <label style={{ ...cl, marginBottom: 16 }}>Token JWT<input type="password" style={inp} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="eyJ..." /></label>
        <motion.button
          whileHover={{ scale: 1.02, y: -1 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => { if (!tokenInput.trim()) return; localStorage.setItem('token', tokenInput.trim()); localStorage.setItem('mitaller_token', tokenInput.trim()); document.cookie = `admin-token=${tokenInput.trim()}; path=/; max-age=${60*60*24*7}; SameSite=Lax`; setToken(tokenInput.trim()); loadAll(tokenInput.trim(), 'list'); }}
          style={{ ...btnP, width: '100%' }}
        >Entrar →</motion.button>
      </motion.div>
    </div>
  );

  return (
    <div className="adminx" style={{ minHeight: '100vh', display: 'flex', position: 'relative', overflow: 'hidden', background: t.bgBase, fontFamily: FONT, color: t.text, transition: 'background .45s ease, color .3s ease' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes drawIn{from{stroke-dashoffset:2000}to{stroke-dashoffset:0}}
        .adminx button,.adminx a[href]{transition:background .2s,border-color .2s,box-shadow .25s,color .18s,filter .15s}
        .adminx button:active{transform:scale(.95)}
        .ad-nav:hover{background:${t.hover} !important}
        .ad-card{transition:border-color .25s,box-shadow .25s}.ad-card:hover{border-color:${ACCENT}33 !important}
        .ad-btnP:hover{box-shadow:0 16px 30px -10px ${ACCENT}cc !important;filter:brightness(1.04)}
        .ad-spin:hover svg{animation:spin .7s cubic-bezier(.4,0,.2,1)}
        .ad-row{transition:background .16s,box-shadow .2s}
        .ad-row:hover{background:${t.hover} !important;box-shadow:inset 3px 0 0 ${ACCENT}}
        .ad-row:hover .ad-av{transform:scale(1.1) rotate(-4deg)}.ad-av{transition:transform .22s cubic-bezier(.34,1.56,.64,1)}
        .ad-row:hover .ad-amt{transform:translateX(-3px)}.ad-amt{transition:transform .18s}
        .ad-pill:hover{transform:translateY(-2px);box-shadow:0 6px 16px -6px rgba(0,0,0,.35)}
        .ad-chartline{stroke-dasharray:2000;animation:drawIn 1.3s cubic-bezier(.4,0,.2,1) forwards}
        .ad-donut circle{transition:stroke-width .2s}.ad-donut:hover circle{stroke-width:13}
        input:focus,select:focus,textarea:focus{border-color:${ACCENT}88 !important;box-shadow:0 0 0 3px ${ACCENT}1f !important;outline:none}
        ::placeholder{color:${t.faint}}
      `}</style>

      <div style={{ position: 'fixed', inset: 0, backgroundImage: mesh, pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, backgroundImage: GRAIN, opacity: dark ? 0.045 : 0.03, mixBlendMode: dark ? 'screen' : 'multiply', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, backgroundImage: `linear-gradient(${dark ? 'rgba(255,255,255,0.016)' : 'rgba(20,22,28,0.018)'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? 'rgba(255,255,255,0.016)' : 'rgba(20,22,28,0.018)'} 1px, transparent 1px)`, backgroundSize: '44px 44px', pointerEvents: 'none', zIndex: 0 }} />

      {/* TOASTS */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 999 }}>
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1, transition: { type: 'spring', damping: 20, stiffness: 300 } }}
              exit={{ opacity: 0, x: 40, scale: 0.9, transition: { duration: 0.18 } }}
              style={{ padding: '12px 18px', borderRadius: 11, fontSize: 14, fontWeight: 600, background: toast.ok ? `linear-gradient(140deg,${ACCENT},${ACCENT2})` : '#e06a6a', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}
            >{toast.msg}</motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* SIDEBAR */}
      <div style={{ position: 'relative', zIndex: 3, width: 240, flexShrink: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '20px 14px', background: t.side, backdropFilter: 'blur(20px)', borderRight: `1px solid ${t.border}` }}>
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 8px 20px' }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(140deg,${ACCENT},${ACCENT2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: '#fff', boxShadow: `0 6px 16px -4px ${ACCENT}88, 0 1px 0 rgba(255,255,255,0.3) inset` }}>S</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.02em', color: t.text }}>Speedwear</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: t.faint }}>Devoluciones</span>
          </div>
        </motion.div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: t.faint, letterSpacing: '0.08em', padding: '0 10px 8px' }}>GESTIÓN</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SIDE.map((s, i) => {
            const on = tab === s.id;
            return (
              <motion.button
                key={s.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ x: 3 }}
                whileTap={{ scale: 0.97 }}
                className="ad-nav"
                onClick={() => setTab(s.id)}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? t.text : t.dim, background: on ? 'rgba(52,178,123,0.10)' : 'transparent', textAlign: 'left' }}
              >
                {on && (
                  <motion.span
                    layoutId="nav-indicator"
                    style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 4, background: ACCENT }}
                  />
                )}
                <Icon d={s.icon} c={on ? ACCENT : t.dim} />
                <span style={{ flex: 1 }}>{s.label}</span>
                {!!s.badge && s.badge > 0 && (
                  <motion.span
                    key={s.badge}
                    initial={{ scale: 0.7 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 14, stiffness: 350 }}
                    style={{ fontSize: 10.5, fontWeight: 700, color: on ? ACCENT : t.dim, background: on ? 'rgba(52,178,123,0.15)' : t.head, borderRadius: 100, padding: '1px 7px' }}
                  >{s.badge}</motion.span>
                )}
              </motion.button>
            );
          })}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="/devoluciones" target="_blank" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, fontSize: 13, color: t.dim, textDecoration: 'none', border: `1px solid ${t.border}`, background: t.card }}>
            <Icon d={ICONS.returns} size={15} c={t.dim} /> Ver portal ↗
          </a>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', borderRadius: 10, background: t.card, border: `1px solid ${t.border}` }}>
            <span style={{ fontSize: 12.5, color: t.dim }}>{dark ? 'Modo oscuro' : 'Modo claro'}</span>
            <button onClick={() => setDark(d => !d)} style={{ width: 44, height: 24, borderRadius: 100, border: `1px solid ${t.border}`, background: dark ? 'rgba(52,178,123,0.25)' : '#E2E5EA', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background .2s' }}>
              <motion.div
                layout
                transition={{ type: 'spring', damping: 20, stiffness: 400 }}
                style={{ position: 'absolute', top: 2, left: dark ? 22 : 2, width: 18, height: 18, borderRadius: '50%', background: dark ? ACCENT : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
              />
            </button>
          </div>
          <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, fontSize: 13, color: t.dim, background: 'transparent', border: `1px solid ${t.border}`, cursor: 'pointer', fontFamily: FONT }}>
            <Icon d={ICONS.logout} size={15} c={t.dim} /> Cerrar sesión
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', borderBottom: `1px solid ${t.border}` }}>
          <motion.div
            key={tab + '-header'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
          >
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: t.text }}>{tab === 'list' ? 'Devoluciones' : tab === 'config' ? 'Configuración' : tab === 'branding' ? 'Personalización' : 'Excepciones'}</div>
            <div style={{ fontSize: 12.5, color: t.dim, marginTop: 1 }}>{new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}{tab === 'list' && ` · ${filtered.length} transacciones`}</div>
          </motion.div>
          {tab === 'list' && (
            <motion.div
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 13px', borderRadius: 10, background: t.card, border: `1px solid ${t.border}`, minWidth: 230 }}>
                <Icon d={ICONS.search} size={15} c={t.faint} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar pedido o cliente…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: t.text, fontFamily: FONT }} />
              </div>
              <motion.button
                whileHover={{ rotate: 180 }}
                transition={{ duration: 0.4 }}
                className="ad-spin"
                onClick={() => loadAll(token, 'list')}
                style={{ width: 38, height: 38, borderRadius: 10, background: t.card, border: `1px solid ${t.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon d={ICONS.refresh} size={16} c={t.dim} />
              </motion.button>
            </motion.div>
          )}
        </div>

        <div style={{ flex: 1, padding: '20px 28px', overflow: 'auto' }}>
          <AnimatePresence mode="wait">

            {/* ── LIST ── */}
            {tab === 'list' && (
              <motion.div key="list" variants={tabVariants} initial="initial" animate="animate" exit="exit">
                <motion.div
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 14, marginBottom: 14 }}
                >
                  <motion.div variants={cardItem} className="ad-card" style={{ padding: '18px 20px 6px', borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', overflow: 'hidden' }}>
                    <div style={{ fontSize: 13, color: t.dim }}>Devoluciones · últimos 14 días</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: '5px 0 4px' }}>
                      <span style={{ fontSize: 27, fontWeight: 750, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{daily.reduce((a, b) => a + b, 0)}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT }}>últimas 2 semanas</span>
                    </div>
                    <AreaChart data={daily} color={ACCENT} dark={dark} />
                  </motion.div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 14 }}>
                    {stats.map((s, i) => (
                      <motion.div
                        key={s.label}
                        variants={cardItem}
                        transition={{ delay: i * 0.07 }}
                        whileHover={{ y: -4, boxShadow: '0 22px 46px -18px rgba(0,0,0,.55)', borderColor: `${ACCENT}55` }}
                        className="ad-lift"
                        style={{ padding: '13px 15px', borderRadius: 14, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', cursor: 'default' }}
                      >
                        <span style={{ fontSize: 11.5, color: t.dim }}>{s.label}</span>
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 }}>
                          <span style={{ fontSize: 21, fontWeight: 750, color: t.text, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                          <Spark data={s.spark} color={s.accent} />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

                <motion.div
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}
                >
                  <motion.div variants={cardItem} className="ad-card" style={{ padding: '16px 20px', borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: t.text, marginBottom: 12 }}>Motivos de devolución</div>
                    {reasons.total === 0
                      ? <div style={{ fontSize: 13, color: t.faint, padding: '20px 0' }}>Sin datos todavía</div>
                      : <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                          <Donut segments={reasons.entries.map(([k, v]) => ({ value: v, color: REASON_LABELS[k]?.color ?? '#8A8A96' }))} total={reasons.total} dark={dark} />
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {reasons.entries.slice(0, 5).map(([k, v]) => (
                              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 3, background: REASON_LABELS[k]?.color ?? '#8A8A96', flexShrink: 0 }} />
                                <span style={{ fontSize: 12, color: t.text2, flex: 1 }}>{REASON_LABELS[k]?.label ?? k}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: t.dim }}>{Math.round((v / reasons.total) * 100)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                    }
                  </motion.div>
                  <motion.div variants={cardItem} className="ad-card" style={{ padding: '16px 20px', borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: t.text, marginBottom: 12 }}>Filtrar por estado</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                      {([['ALL', 'Todas'], ...Object.entries(STATUS_META).map(([k, v]) => [k, v.label])] as [string, string][]).map(([key, label]) => {
                        const on = filterStatus === key;
                        return (
                          <motion.button
                            key={key}
                            whileHover={{ y: -2, boxShadow: '0 6px 16px -6px rgba(0,0,0,.35)' }}
                            whileTap={{ scale: 0.95 }}
                            className="ad-pill"
                            onClick={() => setFilter(key)}
                            style={{ padding: '6px 13px', fontSize: 12.5, fontWeight: on ? 600 : 500, borderRadius: 100, cursor: 'pointer', fontFamily: FONT, background: on ? 'rgba(52,178,123,0.12)' : t.head, color: on ? ACCENT : t.dim, border: `1px solid ${on ? ACCENT + '55' : t.border}` }}
                          >{label}</motion.button>
                        );
                      })}
                    </div>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as 'date' | 'status')} style={{ ...inp, width: 'auto', padding: '7px 11px', fontSize: 13 }}>
                      <option value="date">Recientes primero</option><option value="status">Por estado</option>
                    </select>
                  </motion.div>
                </motion.div>

                <motion.div
                  variants={cardItem}
                  initial="initial"
                  animate="animate"
                  style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', overflow: 'hidden' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', borderBottom: `1px solid ${t.border}` }}>
                    <span style={{ fontSize: 14.5, fontWeight: 650, color: t.text }}>Transacciones recientes</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT, background: 'rgba(52,178,123,0.12)', padding: '2px 9px', borderRadius: 100 }}>{filtered.length}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px 115px 150px 80px', padding: '10px 20px', background: t.head, borderBottom: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.faint, letterSpacing: '0.06em' }}>
                    <span>PEDIDO</span><span>CLIENTE</span><span>FECHA</span><span>TIPO</span><span>ESTADO</span><span style={{ textAlign: 'right' }}>IMPORTE</span>
                  </div>
                  {loading && <div style={{ textAlign: 'center', color: t.faint, padding: 60 }}>Cargando…</div>}
                  {!loading && filtered.length === 0 && <div style={{ textAlign: 'center', padding: '60px 20px', color: t.faint }}>{returns.length === 0 ? 'No hay devoluciones todavía' : 'Sin resultados'}</div>}
                  <motion.div variants={staggerContainer} initial="initial" animate="animate">
                    {!loading && filtered.map((ret, i) => {
                      const s = STATUS_META[ret.status] ?? { label: ret.status, fg: t.dim, bg: t.head, dot: t.faint };
                      const amount = ret.type === 'EXCHANGE' ? (ret.totalAmount ?? 0) : (ret.shopifyRefundAmount ?? ret.refundAmount ?? ret.totalAmount ?? 0);
                      const amtLabel = ret.type === 'EXCHANGE' ? (amount > 0 ? `+${amount.toFixed(2)}€` : '—') : (amount > 0 ? `−${amount.toFixed(2)}€` : '—');
                      const amtColor = amount <= 0 ? t.faint : ret.type === 'EXCHANGE' ? '#f0b429' : ACCENT;
                      const initials = ret.customerName?.split(' ').map((n: string) => n[0]).slice(0, 2).join('') ?? '?';
                      return (
                        <motion.div
                          key={ret.id}
                          variants={rowItem}
                          className="ad-row"
                          onClick={() => { window.location.href = `/admin/devoluciones/${ret.id}`; }}
                          style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px 115px 150px 80px', padding: '13px 20px', alignItems: 'center', borderTop: i === 0 ? 'none' : `1px solid ${t.borderSoft}`, cursor: 'pointer' }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 14, fontWeight: 650, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{ret.shopifyOrderNumber}</span>
                              {ret.status === 'REQUESTED' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e06a6a', boxShadow: '0 0 6px #e06a6a' }} />}
                            </div>
                            <div style={{ fontSize: 11, color: t.faint, marginTop: 1 }}>{ret.items?.length ?? 0} art.</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                            <div className="ad-av" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: `${AV[i % AV.length]}22`, border: `1px solid ${AV[i % AV.length]}44`, color: AV[i % AV.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700 }}>{initials}</div>
                            <div>
                              <div style={{ fontSize: 13.5, fontWeight: 500, color: t.text }}>{ret.customerName}</div>
                              <div style={{ fontSize: 12, color: t.dim }}>{ret.customerEmail}</div>
                            </div>
                          </div>
                          <div style={{ fontSize: 12.5, color: t.dim }}>{timeAgo(ret.updatedAt ?? ret.createdAt)}</div>
                          <div><span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 8, background: ret.type === 'EXCHANGE' ? 'rgba(155,140,219,0.12)' : 'rgba(91,155,213,0.12)', color: ret.type === 'EXCHANGE' ? '#9b8cdb' : '#5b9bd5' }}>{ret.type === 'EXCHANGE' ? 'Cambio' : 'Devolución'}</span></div>
                          <div><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 100, color: s.fg, background: s.bg }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, boxShadow: `0 0 6px ${s.dot}aa` }} />{s.label}</span></div>
                          <div className="ad-amt" style={{ textAlign: 'right', fontSize: 14, fontWeight: 650, color: amtColor, fontVariantNumeric: 'tabular-nums' }}>{amtLabel}</div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </motion.div>
              </motion.div>
            )}

            {/* ── CONFIG ── */}
            {tab === 'config' && configDraft && !loading && (
              <motion.div key="config" variants={tabVariants} initial="initial" animate="animate" exit="exit">
                <motion.div
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', overflow: 'hidden' }}>
                      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 32, height: 32, borderRadius: 9, background: configDraft.enabled ? 'rgba(52,178,123,0.15)' : 'rgba(224,106,106,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{configDraft.enabled ? '✓' : '✗'}</span>
                        <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Estado del sistema</div><div style={{ fontSize: 12, color: t.dim }}>Activa o pausa el portal</div></div>
                        <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100, background: configDraft.enabled ? 'rgba(52,178,123,0.14)' : 'rgba(224,106,106,0.14)', color: configDraft.enabled ? '#3fb98a' : '#e06a6a' }}>{configDraft.enabled ? 'Activo' : 'Pausado'}</span>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={configDraft.enabled} onChange={e => setDraft({ ...configDraft, enabled: e.target.checked })} style={{ width: 18, height: 18, accentColor: ACCENT }} />
                        <div><div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>Sistema de devoluciones activo</div><div style={{ fontSize: 12, color: t.dim, marginTop: 2 }}>Los clientes pueden solicitar devoluciones</div></div>
                      </label>
                    </motion.div>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Plazos y precios</div></div>
                      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <label style={cl}><span>Plazo de devolución (días)</span><input type="number" min={1} max={365} style={inp} value={configDraft.windowDays} onChange={e => setDraft({ ...configDraft, windowDays: Number(e.target.value) })} /><span style={{ fontSize: 11.5, color: t.faint }}>{configDraft.windowDays} días desde la entrega</span></label>
                        <label style={cl}><span>Precio etiqueta (€)</span><input type="number" step="0.01" min={0} style={inp} value={configDraft.labelPrice} onChange={e => setDraft({ ...configDraft, labelPrice: Number(e.target.value) })} /><span style={{ fontSize: 11.5, color: t.faint }}>{configDraft.labelPrice === 0 ? 'Gratuita' : `${configDraft.labelPrice}€ al cliente`}</span></label>
                      </div>
                    </motion.div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Política de cambios</div></div>
                      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <label style={cl}><span>Política</span>
                          <select style={inp} value={configDraft.exchangePolicy} onChange={e => setDraft({ ...configDraft, exchangePolicy: e.target.value })}>
                            <option value="ANY">Cualquier producto del catálogo</option><option value="SAME_TYPE">Mismo tipo de producto</option><option value="VARIANT_ONLY">Solo otra variante del mismo</option>
                          </select></label>
                        <label style={cl}><span>Código SendCloud retorno</span><input type="text" style={inp} value={configDraft.shippingProductCode ?? ''} placeholder="correos:paqretorno" onChange={e => setDraft({ ...configDraft, shippingProductCode: e.target.value || null })} /></label>
                      </div>
                    </motion.div>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Términos legales</div></div>
                      <div style={{ padding: '18px 20px' }}><textarea style={{ ...inp, minHeight: 100, resize: 'vertical' }} value={configDraft.termsText ?? ''} onChange={e => setDraft({ ...configDraft, termsText: e.target.value || null })} placeholder="Política de devoluciones…" /></div>
                    </motion.div>
                    <motion.div variants={cardItem} style={{ display: 'flex', gap: 10 }}>
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={() => setDraft(config)} style={btnS}>Descartar</motion.button>
                      <motion.button whileHover={{ y: -2, boxShadow: `0 16px 30px -10px ${ACCENT}cc` }} whileTap={{ scale: 0.97 }} onClick={saveConfig} className="ad-btnP" disabled={savingConfig} style={{ ...btnP, flex: 1, opacity: savingConfig ? 0.5 : 1 }}>{savingConfig ? 'Guardando…' : 'Guardar cambios'}</motion.button>
                    </motion.div>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* ── BRANDING ── */}
            {tab === 'branding' && portalDraft && !loading && (
              <motion.div key="branding" variants={tabVariants} initial="initial" animate="animate" exit="exit">
                <motion.div
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Textos del portal</div></div>
                      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <label style={cl}><span>Título principal</span><input type="text" style={inp} value={portalDraft.titleText} onChange={e => setPortalDraft({ ...portalDraft, titleText: e.target.value })} /></label>
                        <label style={cl}><span>Subtítulo</span><input type="text" style={inp} value={portalDraft.subtitleText} onChange={e => setPortalDraft({ ...portalDraft, subtitleText: e.target.value })} /></label>
                      </div>
                    </motion.div>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Color y estilo</div></div>
                      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <label style={cl}><span>Color principal</span>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <input type="color" value={portalDraft.primaryColor} onChange={e => setPortalDraft({ ...portalDraft, primaryColor: e.target.value })} style={{ width: 46, height: 46, border: `1px solid ${t.border}`, borderRadius: 10, cursor: 'pointer', padding: 3, background: t.inputBg, flexShrink: 0 }} />
                            <input type="text" style={{ ...inp, flex: 1 }} value={portalDraft.primaryColor} onChange={e => setPortalDraft({ ...portalDraft, primaryColor: e.target.value })} />
                          </div>
                        </label>
                        <label style={cl}><span>Estilo tarjeta</span>
                          <select style={inp} value={portalDraft.cardStyle} onChange={e => setPortalDraft({ ...portalDraft, cardStyle: e.target.value })}><option value="light">Claro</option><option value="dark">Oscuro</option></select>
                        </label>
                      </div>
                    </motion.div>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, border: `1px solid ${t.border}`, overflow: 'hidden', background: portalDraft.cardStyle === 'dark' ? '#0f172a' : '#f8fafc' }}>
                      <div style={{ padding: '10px 16px', fontSize: 10.5, color: t.faint, fontWeight: 600, letterSpacing: '0.06em', borderBottom: `1px solid ${t.border}` }}>PREVIEW</div>
                      <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {portalDraft.logoUrl && <img src={portalDraft.logoUrl} alt="" style={{ height: 26, objectFit: 'contain', objectPosition: 'left' }} />}
                        <div style={{ fontSize: 16, fontWeight: 750, color: portalDraft.cardStyle === 'dark' ? '#fff' : '#111', letterSpacing: '-0.02em' }}>{portalDraft.titleText || 'Cambios & Devoluciones'}</div>
                        <div style={{ fontSize: 12, color: portalDraft.cardStyle === 'dark' ? 'rgba(255,255,255,0.5)' : '#64748b' }}>{portalDraft.subtitleText || 'Gestiona tu devolución'}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ height: 36, flex: 1, borderRadius: 9, background: `${portalDraft.primaryColor}20`, border: `1px solid ${portalDraft.primaryColor}40`, display: 'flex', alignItems: 'center', paddingLeft: 12 }}><span style={{ fontSize: 12, color: portalDraft.cardStyle === 'dark' ? 'rgba(255,255,255,0.3)' : '#94a3b8' }}>#1234</span></div>
                          <div style={{ height: 36, paddingInline: 14, borderRadius: 9, background: portalDraft.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>Buscar</div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Imágenes</div></div>
                      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <label style={cl}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Logo{portalDraft.logoUrl && <img src={portalDraft.logoUrl} alt="" style={{ height: 18, borderRadius: 3, objectFit: 'contain' }} />}</span><input type="url" style={inp} value={portalDraft.logoUrl ?? ''} placeholder="https://cdn.shopify.com/…" onChange={e => setPortalDraft({ ...portalDraft, logoUrl: e.target.value || null })} /></label>
                        <label style={cl}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Favicon{portalDraft.faviconUrl && <img src={portalDraft.faviconUrl} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />}</span><input type="url" style={inp} value={portalDraft.faviconUrl ?? ''} placeholder="https://…/favicon.png" onChange={e => setPortalDraft({ ...portalDraft, faviconUrl: e.target.value || null })} /></label>
                        <label style={cl}><span>Imagen de fondo</span><input type="url" style={inp} value={portalDraft.backgroundUrl ?? ''} placeholder="https://…" onChange={e => setPortalDraft({ ...portalDraft, backgroundUrl: e.target.value || null })} /></label>
                      </div>
                    </motion.div>
                    <motion.div variants={cardItem} style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                      <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 14, fontWeight: 650, color: t.text }}>Legal</div></div>
                      <div style={{ padding: '18px 20px' }}><label style={cl}><span>URL política</span><input type="url" style={inp} value={portalDraft.policyUrl ?? ''} placeholder="https://speedwear.es/policies/refund-policy" onChange={e => setPortalDraft({ ...portalDraft, policyUrl: e.target.value || null })} /></label></div>
                    </motion.div>
                    <motion.div variants={cardItem} style={{ display: 'flex', gap: 10 }}>
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={() => setPortalDraft(portalCfg)} style={btnS}>Descartar</motion.button>
                      <motion.button whileHover={{ y: -2, boxShadow: `0 16px 30px -10px ${ACCENT}cc` }} whileTap={{ scale: 0.97 }} onClick={saveBranding} className="ad-btnP" disabled={savingPortal} style={{ ...btnP, flex: 1, opacity: savingPortal ? 0.5 : 1 }}>{savingPortal ? 'Guardando…' : 'Guardar personalización'}</motion.button>
                    </motion.div>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* ── EXCEPTIONS ── */}
            {tab === 'exceptions' && !loading && (
              <motion.div key="exceptions" variants={tabVariants} initial="initial" animate="animate" exit="exit">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                  <div><div style={{ fontSize: 15, fontWeight: 650, color: t.text }}>Excepciones activas</div><div style={{ fontSize: 12.5, color: t.dim, marginTop: 2 }}>{exceptionGroups.length} pedido{exceptionGroups.length !== 1 ? 's' : ''} con reglas</div></div>
                  <motion.button
                    whileHover={{ y: -2, boxShadow: `0 16px 30px -10px ${ACCENT}cc` }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowNewEx(true)}
                    className="ad-btnP"
                    style={btnP}
                  >+ Nueva excepción</motion.button>
                </div>
                {exceptionGroups.length === 0 && (
                  <motion.div variants={cardItem} initial="initial" animate="animate"
                    style={{ padding: '40px 20px', borderRadius: 16, background: t.card, border: `1px dashed ${t.border}`, textAlign: 'center', color: t.dim, fontSize: 13.5 }}>
                    Sin excepciones. Crea una para un pedido y añade dentro las opciones que necesites.
                  </motion.div>
                )}
                {exceptionGroups.length > 0 && (
                  <motion.div
                    variants={staggerContainer}
                    initial="initial"
                    animate="animate"
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}
                  >
                    <AnimatePresence>
                      {exceptionGroups.map((g) => {
                        const OPTS: Array<{ key: string; emoji: string; desc: string }> = [
                          { key: 'EXTEND_WINDOW',  emoji: '📅', desc: 'Amplía el plazo' },
                          { key: 'FREE_LABEL',     emoji: '🏷️', desc: 'Sin coste de etiqueta' },
                          { key: 'ACCEPT_EXPIRED', emoji: '✅', desc: 'Aceptar fuera de plazo' },
                          { key: 'BLOCK',          emoji: '🚫', desc: 'Bloquea devoluciones' },
                        ];
                        return (
                          <motion.div
                            key={g.key}
                            variants={cardItem}
                            exit={{ opacity: 0, scale: 0.94, y: -8, transition: { duration: 0.2 } }}
                            className="ad-lift"
                            style={{ padding: '18px 20px', borderRadius: 16, background: t.card, border: `1px solid ${ACCENT}33`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', position: 'relative', overflow: 'hidden' }}
                          >
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${ACCENT},transparent)` }} />
                            {/* Header: target */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                              {g.orderNumber && <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span style={{ fontSize: 11, fontWeight: 600, color: t.faint, width: 52 }}>PEDIDO</span><span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{g.orderNumber}</span></div>}
                              {g.customerEmail && <div style={{ display: 'flex', gap: 8 }}><span style={{ fontSize: 11, fontWeight: 600, color: t.faint, width: 52 }}>EMAIL</span><span style={{ fontSize: 12.5, color: t.text2 }}>{g.customerEmail}</span></div>}
                            </div>
                            {/* Option rows */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {OPTS.map((o) => {
                                const rule = g.rules[o.key];
                                const on = !!rule;
                                const meta = EXCEPTION_LABELS[o.key];
                                return (
                                  <div key={o.key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px', borderRadius: 10, background: on ? meta.color + '12' : t.head, border: `1px solid ${on ? meta.color + '33' : t.border}`, transition: 'all .2s' }}>
                                    <span style={{ fontSize: 16 }}>{o.emoji}</span>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: on ? meta.color : t.dim }}>{meta.label}</div>
                                      {on && o.key === 'EXTEND_WINDOW'
                                        ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                            <span style={{ fontSize: 11.5, color: t.dim }}>+</span>
                                            <input type="number" min={1} max={365} value={rule.extraDays ?? 7}
                                              onChange={e => setRuleDays(rule.id, Number(e.target.value))}
                                              style={{ width: 56, padding: '3px 7px', borderRadius: 7, border: `1px solid ${t.border}`, background: t.inputBg, color: t.text, fontSize: 12, fontFamily: FONT }} />
                                            <span style={{ fontSize: 11.5, color: t.dim }}>días</span>
                                          </div>
                                        : <div style={{ fontSize: 11.5, color: t.faint, marginTop: 1 }}>{o.desc}</div>}
                                    </div>
                                    <div onClick={() => on ? removeRule(rule.id) : addRuleToGroup(g, o.key)} style={{ cursor: 'pointer', flexShrink: 0 }}>
                                      <div style={{ width: 38, height: 22, borderRadius: 100, background: on ? meta.color : t.head, border: `1px solid ${on ? meta.color : t.border}`, position: 'relative', transition: 'background .2s' }}>
                                        <motion.div layout transition={{ type: 'spring', damping: 20, stiffness: 400 }}
                                          style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <motion.button
                              whileHover={{ borderColor: '#e06a6a66', color: '#e06a6a' }}
                              whileTap={{ scale: 0.97 }}
                              onClick={() => deleteGroup(g.ids)}
                              style={{ marginTop: 14, width: '100%', padding: '8px', fontSize: 12.5, fontWeight: 500, background: 'transparent', border: `1px solid ${t.border}`, color: t.dim, borderRadius: 9, cursor: 'pointer', fontFamily: FONT }}
                            >Eliminar excepción</motion.button>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </motion.div>
                )}

                {/* New exception modal */}
                <AnimatePresence>
                  {showNewEx && (
                    <motion.div
                      key="overlay"
                      variants={overlayVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      onClick={() => setShowNewEx(false)}
                      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
                    >
                      <motion.div
                        key="drawer"
                        variants={drawerVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        onClick={e => e.stopPropagation()}
                        style={{ background: t.drawer, borderRadius: 18, width: '100%', maxWidth: 500, padding: 28, boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)', border: `1px solid ${t.border}`, margin: 16 }}
                      >
                        <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: t.text }}>Nueva excepción</h3>
                        <p style={{ margin: '0 0 22px', fontSize: 13, color: t.dim }}>Regla especial para un pedido o cliente</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <label style={cl}><span>Nº pedido</span><input type="text" style={inp} placeholder="#12345" value={newEx.orderNumber} onChange={e => setNewEx({ ...newEx, orderNumber: e.target.value })} /></label>
                            <label style={cl}><span>Email</span><input type="email" style={inp} placeholder="cliente@email.com" value={newEx.customerEmail} onChange={e => setNewEx({ ...newEx, customerEmail: e.target.value })} /></label>
                          </div>
                          <div style={cl}><span>Opciones</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                              {([['EXTEND_WINDOW','📅 Ampliar plazo'],['FREE_LABEL','🏷️ Etiqueta gratis'],['ACCEPT_EXPIRED','✅ Aceptar fuera de plazo'],['BLOCK','🚫 Bloquear devolución']] as [string,string][]).map(([key,label]) => {
                                const on = newEx.opts[key];
                                const meta = EXCEPTION_LABELS[key];
                                return (
                                  <div key={key} onClick={() => setNewEx(p => ({ ...p, opts: { ...p.opts, [key]: !p.opts[key] } }))}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', background: on ? meta.color + '12' : t.head, border: `1px solid ${on ? meta.color + '44' : t.border}` }}>
                                    <div style={{ width: 18, height: 18, borderRadius: 6, border: `1.5px solid ${on ? meta.color : t.border}`, background: on ? meta.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, color: '#fff', fontWeight: 800 }}>{on ? '✓' : ''}</div>
                                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: on ? meta.color : t.text2 }}>{label}</span>
                                    {key === 'EXTEND_WINDOW' && on && (
                                      <input type="number" min={1} max={365} value={newEx.extraDays} onClick={e => e.stopPropagation()} onChange={e => setNewEx(p => ({ ...p, extraDays: Number(e.target.value) }))}
                                        style={{ width: 64, padding: '4px 8px', borderRadius: 7, border: `1px solid ${t.border}`, background: t.inputBg, color: t.text, fontSize: 12, fontFamily: FONT }} />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <label style={cl}><span>Notas</span><input type="text" style={inp} placeholder="Cliente VIP…" value={newEx.notes} onChange={e => setNewEx({ ...newEx, notes: e.target.value })} /></label>
                            <label style={cl}><span>Expira</span><input type="date" style={inp} value={newEx.expiresAt} onChange={e => setNewEx({ ...newEx, expiresAt: e.target.value })} /></label>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={() => setShowNewEx(false)} style={btnS}>Cancelar</motion.button>
                          <motion.button whileHover={{ y: -2, boxShadow: `0 16px 30px -10px ${ACCENT}cc` }} whileTap={{ scale: 0.97 }} onClick={createException} className="ad-btnP" style={{ ...btnP, flex: 1 }}>Crear excepción</motion.button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

          </AnimatePresence>

          {loading && tab !== 'list' && <div style={{ textAlign: 'center', color: t.faint, padding: 60 }}>Cargando…</div>}
        </div>
      </div>
    </div>
  );
}
