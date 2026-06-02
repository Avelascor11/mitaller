'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const ACCENT = '#34B27B';
const ACCENT2 = '#2A9D8F';

const STATUS_META: Record<string, { label: string; fg: string; bg: string; dot: string; step: number }> = {
  REQUESTED:     { label: 'En espera',        fg: '#f0b429', bg: 'rgba(240,180,41,0.12)',  dot: '#f0b429', step: 0 },
  LABEL_CREATED: { label: 'Etiqueta enviada', fg: '#5b9bd5', bg: 'rgba(91,155,213,0.12)',  dot: '#5b9bd5', step: 1 },
  RECEIVED:      { label: 'Por revisar',      fg: '#9b8cdb', bg: 'rgba(155,140,219,0.12)', dot: '#9b8cdb', step: 3 },
  APPROVED:      { label: 'Aprobada',         fg: '#3fb98a', bg: 'rgba(63,185,138,0.12)',  dot: '#3fb98a', step: 4 },
  REJECTED:      { label: 'Rechazada',        fg: '#e06a6a', bg: 'rgba(224,106,106,0.12)', dot: '#e06a6a', step: 4 },
  CANCELLED:     { label: 'Cancelada',        fg: '#8A8A96', bg: 'rgba(138,138,150,0.12)', dot: '#8A8A96', step: 4 },
};

const EXCEPTION_LABELS: Record<string, { label: string; color: string }> = {
  EXTEND_WINDOW:  { label: 'Ampliar plazo',   color: '#5b9bd5' },
  FREE_LABEL:     { label: 'Etiqueta gratis',  color: '#3fb98a' },
  ACCEPT_EXPIRED: { label: 'Aceptar expirado', color: '#f0b429' },
  BLOCK:          { label: 'Bloqueado',        color: '#e06a6a' },
};

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  WRONG_SIZE:      { label: 'Talla incorrecta',    color: '#5b9bd5' },
  DEFECTIVE:       { label: 'Defectuoso',           color: '#e06a6a' },
  NOT_AS_DESCRIBED:{ label: 'No como esperaba',     color: '#9b8cdb' },
  CHANGED_MIND:    { label: 'Cambio de opinión',    color: '#f0b429' },
  WRONG_ITEM:      { label: 'Artículo incorrecto',  color: '#e0995a' },
  OTHER:           { label: 'Otro',                 color: '#8A8A96' },
};

const AV = ['#34B27B', '#5b9bd5', '#9b8cdb', '#e0995a', '#e06a6a'];

interface ReturnRecord {
  id: string;
  shopifyOrderNumber: string;
  customerName: string;
  customerEmail: string;
  status: string;
  type: string;
  paymentStatus: string;
  labelUrl?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  totalAmount?: number | null;
  refundAmount?: number | null;
  createdAt: string;
  updatedAt?: string;
  receivedAt?: string | null;
  verifiedAt?: string | null;
  verificationStatus?: string | null;
  refundedAt?: string | null;
  shopifyRefundAmount?: number | null;
  order: { orderNumber: string; customerName: string; customerEmail?: string | null };
  items: Array<{
    id: string;
    quantity: number;
    reason: string;
    notes?: string | null;
    replacementTitle?: string | null;
    replacementPrice?: number | null;
    orderItem: { title: string; variantTitle?: string | null; sku: string; imageUrl?: string | null };
  }>;
}

interface ReturnConfig {
  windowDays: number;
  labelPrice: number;
  shippingProductCode: string | null;
  exchangePolicy: 'ANY' | 'SAME_TYPE' | 'VARIANT_ONLY';
  termsText: string | null;
  enabled: boolean;
}

interface ReturnException {
  id: string;
  orderNumber: string | null;
  customerEmail: string | null;
  type: string;
  extraDays: number | null;
  notes: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

interface PortalConfig {
  logoUrl: string | null;
  faviconUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string;
  cardStyle: string;
  titleText: string;
  subtitleText: string;
  policyUrl: string | null;
}

interface Toast { id: number; msg: string; type: 'ok' | 'err' }
type Tab = 'list' | 'config' | 'branding' | 'exceptions';

type Theme = ReturnType<typeof makeTheme>;
function makeTheme(dark: boolean) {
  return dark
    ? {
        dark: true,
        text: '#ECECEF', text2: '#B4B4BE', dim: '#7C7C88', faint: '#56565F',
        card: 'rgba(255,255,255,0.025)', cardSolid: '#16161C', drawer: '#101015',
        border: 'rgba(255,255,255,0.08)', borderSoft: 'rgba(255,255,255,0.05)',
        side: 'rgba(255,255,255,0.015)', head: 'rgba(255,255,255,0.02)',
        hover: 'rgba(255,255,255,0.03)', inputBg: 'rgba(255,255,255,0.04)',
        bgBase: '#08080B',
        shadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 48px -16px rgba(0,0,0,0.65)',
      }
    : {
        dark: false,
        text: '#15171C', text2: '#3C4049', dim: '#6B7280', faint: '#9AA0AA',
        card: 'rgba(255,255,255,0.9)', cardSolid: '#FFFFFF', drawer: '#FFFFFF',
        border: 'rgba(20,22,28,0.08)', borderSoft: 'rgba(20,22,28,0.05)',
        side: 'rgba(255,255,255,0.6)', head: 'rgba(20,22,28,0.02)',
        hover: 'rgba(20,22,28,0.025)', inputBg: 'rgba(255,255,255,1)',
        bgBase: '#EEF0F3',
        shadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 40px -16px rgba(20,22,28,0.16)',
      };
}

const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif";
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ctr = useRef(0);
  function push(msg: string, type: 'ok' | 'err' = 'ok') {
    const id = ++ctr.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }
  return { toasts, ok: (m: string) => push(m, 'ok'), err: (m: string) => push(m, 'err') };
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'Ahora mismo';
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Hace ${d} d`;
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function Icon({ d, size = 17, c, sw = 1.8 }: { d: string; size?: number; c: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
const ICONS = {
  returns: 'M3 7h13a4 4 0 0 1 0 8H8 M8 11l-4 4 4 4',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z|M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  brand: 'M12 3l2.09 4.26L19 8l-3.5 3.4.83 4.85L12 13.9l-4.33 2.35L8.5 11.4 5 8l4.91-.74Z',
  exc: 'M12 9v4|M12 17h.01|M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|M21 21l-4.3-4.3',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9|M13.7 21a2 2 0 0 1-3.4 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9',
  refresh: 'M23 4v6h-6|M1 20v-6h6|M3.51 9a9 9 0 0 1 14.85-3.36L23 10|M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
};

function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) data = [...data, ...data];
  const w = 60, h = 20, max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 4) - 2]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2} fill={color} />
    </svg>
  );
}

function AreaChart({ data, color, dark }: { data: number[]; color: string; dark: boolean }) {
  const safe = data.length >= 2 ? data : [0, 0];
  const w = 560, h = 120, pad = 6, max = Math.max(...safe, 1), min = 0;
  const x = (i: number) => pad + (i / (safe.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2 - 8);
  const line = safe.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(safe.length - 1).toFixed(1)} ${h - pad} L${x(0).toFixed(1)} ${h - pad} Z`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={dark ? 0.34 : 0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0.33, 0.66].map(g => <line key={g} x1={pad} x2={w - pad} y1={h * g} y2={h * g} stroke={dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,22,28,0.05)'} strokeWidth={1} />)}
      <path d={area} fill="url(#ag)" />
      <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(safe.length - 1)} cy={y(safe[safe.length - 1])} r={3.5} fill={color} stroke={dark ? '#0b0b0f' : '#fff'} strokeWidth={2} />
    </svg>
  );
}

function Donut({ segments, total, dark }: { segments: Array<{ value: number; color: string }>; total: number; dark: boolean }) {
  const r = 42, C = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={108} height={108} viewBox="0 0 108 108">
      <g transform="translate(54,54) rotate(-90)">
        <circle r={r} fill="none" stroke={dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,22,28,0.05)'} strokeWidth={11} />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * C;
          const el = <circle key={i} r={r} fill="none" stroke={s.color} strokeWidth={11} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} strokeLinecap="round" />;
          off += len;
          return el;
        })}
      </g>
      <text x={54} y={50} textAnchor="middle" fontSize={20} fontWeight={750} fill={dark ? '#ECECEF' : '#15171C'}>{total}</text>
      <text x={54} y={66} textAnchor="middle" fontSize={9.5} fill={dark ? '#7C7C88' : '#9AA0AA'}>artículos</text>
    </svg>
  );
}

export default function AdminDevolucionesPage() {
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState<Tab>('list');
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(true);
  const { toasts, ok, err } = useToast();

  const [returns, setReturns]     = useState<ReturnRecord[]>([]);
  const [filterStatus, setFilter] = useState('ALL');
  const [search, setSearch]       = useState('');
  const [sortBy, setSortBy]       = useState<'date' | 'status'>('date');

  const [config, setConfig]       = useState<ReturnConfig | null>(null);
  const [configDraft, setDraft]   = useState<ReturnConfig | null>(null);
  const [savingConfig, setSaving] = useState(false);

  const [portalCfg, setPortalCfg]       = useState<PortalConfig | null>(null);
  const [portalDraft, setPortalDraft]   = useState<PortalConfig | null>(null);
  const [savingPortal, setSavingPortal] = useState(false);

  const [exceptions, setExceptions] = useState<ReturnException[]>([]);
  const [showNewEx, setShowNewEx]   = useState(false);
  const [newEx, setNewEx] = useState({ orderNumber: '', customerEmail: '', type: 'EXTEND_WINDOW', extraDays: 7, notes: '', expiresAt: '' });

  const t = makeTheme(dark);

  useEffect(() => {
    const storedTheme = localStorage.getItem('admin-theme');
    if (storedTheme) setDark(storedTheme === 'dark');
    const stored = localStorage.getItem('token') || localStorage.getItem('mitaller_token');
    if (stored) { setToken(stored); loadAll(stored); }
    else { window.location.href = '/login'; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { localStorage.setItem('admin-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (token) loadAll(token); /* eslint-disable-next-line */ }, [tab]);

  function auth(t: string) { return { Authorization: `Bearer ${t}` }; }
  function logout() {
    ['token', 'mitaller_token'].forEach(k => localStorage.removeItem(k));
    document.cookie = 'admin-token=; path=/; max-age=0';
    window.location.href = '/login';
  }

  async function loadAll(jwt: string) {
    setLoading(true);
    try {
      if (tab === 'list') {
        const r = await fetch(`${API_URL}/returns`, { headers: auth(jwt) });
        if (r.status === 401) { logout(); return; }
        setReturns(await r.json());
      } else if (tab === 'config') {
        const r = await fetch(`${API_URL}/returns/admin/config`, { headers: auth(jwt) });
        if (r.status === 401) { logout(); return; }
        const c = await r.json(); setConfig(c); setDraft(c);
      } else if (tab === 'exceptions') {
        const r = await fetch(`${API_URL}/returns/admin/exceptions`, { headers: auth(jwt) });
        if (r.status === 401) { logout(); return; }
        setExceptions(await r.json());
      } else if (tab === 'branding') {
        const r = await fetch(`${API_URL}/portal-config`, { headers: auth(jwt) });
        if (r.status === 401) { logout(); return; }
        const c = await r.json(); setPortalCfg(c); setPortalDraft(c);
      }
    } catch (e) { err(e instanceof Error ? e.message : 'Error cargando'); }
    finally { setLoading(false); }
  }

  async function saveConfig() {
    if (!configDraft) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/returns/admin/config`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(configDraft) });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json(); setConfig(updated); setDraft(updated);
      ok('Configuración guardada ✓');
    } catch (e) { err(e instanceof Error ? e.message : 'Error guardando'); }
    finally { setSaving(false); }
  }

  async function saveBranding() {
    if (!portalDraft) return;
    setSavingPortal(true);
    try {
      const res = await fetch(`${API_URL}/portal-config`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(portalDraft) });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json(); setPortalCfg(updated); setPortalDraft(updated);
      ok('Personalización guardada ✓');
    } catch (e) { err(e instanceof Error ? e.message : 'Error guardando'); }
    finally { setSavingPortal(false); }
  }

  async function createException() {
    if (!newEx.orderNumber && !newEx.customerEmail) { err('Indica número de pedido o email'); return; }
    try {
      const body: Record<string, unknown> = { type: newEx.type, notes: newEx.notes || undefined, expiresAt: newEx.expiresAt || undefined };
      if (newEx.orderNumber) body.orderNumber = newEx.orderNumber;
      if (newEx.customerEmail) body.customerEmail = newEx.customerEmail;
      if (newEx.type === 'EXTEND_WINDOW') body.extraDays = newEx.extraDays;
      const res = await fetch(`${API_URL}/returns/admin/exceptions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).message ?? `Error ${res.status}`);
      ok('Excepción creada ✓');
      setShowNewEx(false);
      setNewEx({ orderNumber: '', customerEmail: '', type: 'EXTEND_WINDOW', extraDays: 7, notes: '', expiresAt: '' });
      loadAll(token);
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
  }

  async function toggleException(id: string, active: boolean) {
    await fetch(`${API_URL}/returns/admin/exceptions/${id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ active }) });
    loadAll(token);
  }

  async function deleteException(id: string) {
    if (!confirm('¿Borrar esta excepción?')) return;
    await fetch(`${API_URL}/returns/admin/exceptions/${id}`, { method: 'DELETE', headers: auth(token) });
    ok('Excepción eliminada');
    loadAll(token);
  }

  // KPIs
  const now30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const kpis = {
    espera:    returns.filter(r => r.status === 'REQUESTED').length,
    revisar:   returns.filter(r => r.status === 'RECEIVED').length,
    aprobadas: returns.filter(r => r.status === 'APPROVED' && !r.refundedAt).length,
    trans30:   returns.filter(r => new Date(r.createdAt).getTime() > now30).length,
    refund:    returns.filter(r => r.refundedAt).reduce((s, r) => s + (r.shopifyRefundAmount ?? r.refundAmount ?? 0), 0),
  };

  // Daily area data (last 14 days, real)
  const daily = useMemo(() => {
    const days = 14;
    const buckets = new Array(days).fill(0);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startMs = start.getTime() - (days - 1) * 86400000;
    returns.forEach(r => {
      const idx = Math.floor((new Date(r.createdAt).getTime() - startMs) / 86400000);
      if (idx >= 0 && idx < days) buckets[idx]++;
    });
    return buckets;
  }, [returns]);

  // Reasons donut (real)
  const reasons = useMemo(() => {
    const map: Record<string, number> = {};
    returns.forEach(r => r.items.forEach(it => { map[it.reason] = (map[it.reason] ?? 0) + it.quantity; }));
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    return { entries, total };
  }, [returns]);

  const stats = [
    { label: 'En espera',   value: String(kpis.espera),  accent: '#f0b429', spark: daily.slice(-7) },
    { label: 'Por revisar', value: String(kpis.revisar), accent: '#9b8cdb', spark: daily.slice(-7) },
    { label: 'Reembolsado', value: `${kpis.refund.toFixed(0)}€`, accent: '#3fb98a', spark: daily.slice(-7) },
    { label: 'Últimos 30d', value: String(kpis.trans30), accent: '#5b9bd5', spark: daily.slice(-7) },
  ];

  // Filtered + sorted list
  const filtered = returns
    .filter(r => {
      const matchStatus = filterStatus === 'ALL' || r.status === filterStatus;
      const q = search.toLowerCase();
      const matchSearch = !q
        || r.shopifyOrderNumber.toLowerCase().includes(q)
        || r.customerName.toLowerCase().includes(q)
        || r.customerEmail.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      return new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
    });

  const inp: React.CSSProperties = {
    padding: '10px 13px', borderRadius: 10, border: `1px solid ${t.border}`,
    fontSize: 14, color: t.text, background: t.inputBg, outline: 'none', width: '100%', fontFamily: FONT,
  };
  const cfgLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13, fontWeight: 500, color: t.text2 };
  const btnPrimary: React.CSSProperties = {
    padding: '11px 18px', background: `linear-gradient(140deg, ${ACCENT}, ${ACCENT2})`, color: '#fff', border: 'none',
    borderRadius: 11, fontSize: 14, fontWeight: 650, cursor: 'pointer', fontFamily: FONT, boxShadow: `0 8px 18px -8px ${ACCENT}aa`,
  };
  const btnSecondary: React.CSSProperties = {
    padding: '10px 16px', background: t.card, color: t.text2, border: `1px solid ${t.border}`,
    borderRadius: 11, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
  };

  // ── LOGIN ──
  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bgBase, fontFamily: FONT }}>
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 18, padding: '36px 32px', width: '100%', maxWidth: 380, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 750, color: t.text, letterSpacing: '-0.02em' }}>Panel de devoluciones</div>
          <div style={{ fontSize: 14, color: t.dim, marginTop: 4 }}>Speedwear Admin</div>
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          if (!tokenInput.trim()) return;
          localStorage.setItem('token', tokenInput.trim());
          localStorage.setItem('mitaller_token', tokenInput.trim());
          setToken(tokenInput.trim());
          loadAll(tokenInput.trim());
        }}>
          <label style={{ ...cfgLabel, marginBottom: 16 }}>
            Token JWT
            <input type="password" style={inp} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="eyJ..." required />
          </label>
          <button type="submit" style={{ ...btnPrimary, width: '100%' }}>Entrar →</button>
        </form>
      </div>
    </div>
  );

  const mesh = dark
    ? `radial-gradient(900px 500px at 12% -8%, rgba(52,178,123,0.10), transparent 60%), radial-gradient(800px 600px at 100% 0%, rgba(91,120,213,0.08), transparent 55%), radial-gradient(700px 500px at 50% 120%, rgba(120,90,200,0.06), transparent 60%)`
    : `radial-gradient(900px 500px at 12% -8%, rgba(52,178,123,0.12), transparent 60%), radial-gradient(800px 600px at 100% 0%, rgba(91,120,213,0.10), transparent 55%)`;

  const SIDE: Array<{ id: Tab; label: string; icon: string; badge?: number }> = [
    { id: 'list', label: 'Devoluciones', icon: ICONS.returns, badge: kpis.espera + kpis.revisar },
    { id: 'config', label: 'Configuración', icon: ICONS.config },
    { id: 'branding', label: 'Personalización', icon: ICONS.brand },
    { id: 'exceptions', label: 'Excepciones', icon: ICONS.exc },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', position: 'relative', overflow: 'hidden', background: t.bgBase, fontFamily: FONT, color: t.text }}>
      <style>{`@keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes fi{from{opacity:0}to{opacity:1}}
        .ad-row:hover{background:${t.hover} !important}
        .ad-input:focus{border-color:${ACCENT}88 !important}
        ::placeholder{color:${t.faint}}`}</style>

      <div style={{ position: 'fixed', inset: 0, backgroundImage: mesh, pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, backgroundImage: GRAIN, opacity: dark ? 0.045 : 0.03, mixBlendMode: dark ? 'screen' : 'multiply', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, backgroundImage: `linear-gradient(${dark ? 'rgba(255,255,255,0.016)' : 'rgba(20,22,28,0.018)'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? 'rgba(255,255,255,0.016)' : 'rgba(20,22,28,0.018)'} 1px, transparent 1px)`, backgroundSize: '44px 44px', pointerEvents: 'none', zIndex: 0 }} />

      {/* Toast */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 999 }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{ padding: '12px 18px', borderRadius: 11, fontSize: 14, fontWeight: 600, background: toast.type === 'ok' ? `linear-gradient(140deg,${ACCENT},${ACCENT2})` : '#e06a6a', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', animation: 'fu 0.2s ease' }}>{toast.msg}</div>
        ))}
      </div>

      {/* SIDEBAR */}
      <div style={{ position: 'relative', zIndex: 3, width: 240, flexShrink: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '20px 14px', background: t.side, backdropFilter: 'blur(20px)', borderRight: `1px solid ${t.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 8px 20px' }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(140deg, ${ACCENT}, ${ACCENT2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: '#fff', boxShadow: `0 6px 16px -4px ${ACCENT}88, 0 1px 0 rgba(255,255,255,0.3) inset` }}>S</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.02em', color: t.text }}>Speedwear</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: t.faint }}>Devoluciones</span>
          </div>
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: t.faint, letterSpacing: '0.08em', padding: '0 10px 8px' }}>GESTIÓN</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SIDE.map(s => {
            const on = tab === s.id;
            return (
              <button key={s.id} onClick={() => setTab(s.id)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? t.text : t.dim, background: on ? 'rgba(52,178,123,0.10)' : 'transparent', transition: 'all .15s', textAlign: 'left' }}>
                {on && <span style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 4, background: ACCENT }} />}
                <Icon d={s.icon} c={on ? ACCENT : t.dim} />
                <span style={{ flex: 1 }}>{s.label}</span>
                {!!s.badge && s.badge > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: on ? ACCENT : t.dim, background: on ? 'rgba(52,178,123,0.15)' : t.head, borderRadius: 100, padding: '1px 7px' }}>{s.badge}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="/devoluciones" target="_blank" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: t.dim, textDecoration: 'none', border: `1px solid ${t.border}`, background: t.card }}>
            <Icon d={ICONS.returns} size={15} c={t.dim} /> Ver portal ↗
          </a>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', borderRadius: 10, background: t.card, border: `1px solid ${t.border}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: t.dim }}>{dark ? 'Modo oscuro' : 'Modo claro'}</span>
            <button onClick={() => setDark(d => !d)} style={{ width: 44, height: 24, borderRadius: 100, border: `1px solid ${t.border}`, background: dark ? 'rgba(52,178,123,0.25)' : '#E2E5EA', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background .2s' }}>
              <div style={{ position: 'absolute', top: 2, left: dark ? 22 : 2, width: 18, height: 18, borderRadius: '50%', background: dark ? ACCENT : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left .22s cubic-bezier(.4,0,.2,1)' }} />
            </button>
          </div>
          <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: t.dim, background: 'transparent', border: `1px solid ${t.border}`, cursor: 'pointer', fontFamily: FONT }}>
            <Icon d={ICONS.logout} size={15} c={t.dim} /> Cerrar sesión
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* topbar */}
        <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', borderBottom: `1px solid ${t.border}` }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: t.text }}>
              {tab === 'list' ? 'Devoluciones' : tab === 'config' ? 'Configuración' : tab === 'branding' ? 'Personalización' : 'Excepciones'}
            </div>
            <div style={{ fontSize: 12.5, color: t.dim, marginTop: 1 }}>
              {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
              {tab === 'list' && ` · ${filtered.length} transacciones`}
            </div>
          </div>
          {tab === 'list' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 13px', borderRadius: 10, background: t.card, border: `1px solid ${t.border}`, minWidth: 230 }}>
                <Icon d={ICONS.search} size={15} c={t.faint} />
                <input className="ad-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar pedido o cliente…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: t.text, fontFamily: FONT }} />
              </div>
              <button onClick={() => loadAll(token)} style={{ width: 38, height: 38, borderRadius: 10, background: t.card, border: `1px solid ${t.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon d={ICONS.refresh} size={16} c={t.dim} />
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, padding: '20px 28px' }}>
          {/* ── LIST ── */}
          {tab === 'list' && (
            <>
              {/* row1: chart + stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 14, marginBottom: 14, animation: 'fu .4s ease both' }}>
                <div style={{ padding: '18px 20px 6px', borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: t.dim }}>Devoluciones · últimos 14 días</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: '5px 0 4px' }}>
                    <span style={{ fontSize: 27, fontWeight: 750, letterSpacing: '-0.02em', color: t.text, fontVariantNumeric: 'tabular-nums' }}>{daily.reduce((a, b) => a + b, 0)}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT }}>últimas 2 semanas</span>
                  </div>
                  <AreaChart data={daily} color={ACCENT} dark={dark} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 14 }}>
                  {stats.map(s => (
                    <div key={s.label} style={{ padding: '13px 15px', borderRadius: 14, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: t.dim }}>{s.label}</span>
                      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 }}>
                        <span style={{ fontSize: 21, fontWeight: 750, letterSpacing: '-0.02em', color: t.text, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                        <Spark data={s.spark} color={s.accent} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* row2: reasons donut + filters card */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, animation: 'fu .5s ease both' }}>
                <div style={{ padding: '16px 20px', borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650, color: t.text, marginBottom: 12 }}>Motivos de devolución</div>
                  {reasons.total === 0 ? (
                    <div style={{ fontSize: 13, color: t.faint, padding: '20px 0' }}>Sin datos todavía</div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                      <Donut segments={reasons.entries.map(([k, v]) => ({ value: v, color: REASON_LABELS[k]?.color ?? '#8A8A96' }))} total={reasons.total} dark={dark} />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {reasons.entries.slice(0, 5).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 3, background: REASON_LABELS[k]?.color ?? '#8A8A96', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: t.text2, flex: 1 }}>{REASON_LABELS[k]?.label ?? k}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: t.dim, fontVariantNumeric: 'tabular-nums' }}>{Math.round((v / reasons.total) * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ padding: '16px 20px', borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650, color: t.text, marginBottom: 12 }}>Filtrar por estado</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {([['ALL', 'Todas'], ...Object.entries(STATUS_META).map(([k, v]) => [k, v.label])] as [string, string][]).map(([key, label]) => {
                      const on = filterStatus === key;
                      return (
                        <button key={key} onClick={() => setFilter(key)} style={{ padding: '6px 13px', fontSize: 12.5, fontWeight: on ? 600 : 500, borderRadius: 100, cursor: 'pointer', fontFamily: FONT, background: on ? 'rgba(52,178,123,0.12)' : t.head, color: on ? ACCENT : t.dim, border: `1px solid ${on ? ACCENT + '55' : t.border}` }}>{label}</button>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: t.dim }}>Ordenar:</span>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as 'date' | 'status')} style={{ ...inp, width: 'auto', padding: '7px 11px', fontSize: 13 }}>
                      <option value="date">Recientes primero</option>
                      <option value="status">Por estado</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* table */}
              <div style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', overflow: 'hidden', animation: 'fu .6s ease both' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ fontSize: 14.5, fontWeight: 650, color: t.text }}>Transacciones recientes</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT, background: 'rgba(52,178,123,0.12)', padding: '2px 9px', borderRadius: 100 }}>{filtered.length}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px 115px 150px 80px', padding: '10px 20px', background: t.head, borderBottom: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.faint, letterSpacing: '0.06em' }}>
                  <span>PEDIDO</span><span>CLIENTE</span><span>FECHA</span><span>TIPO</span><span>ESTADO</span><span style={{ textAlign: 'right' }}>IMPORTE</span>
                </div>

                {loading && <div style={{ textAlign: 'center', color: t.faint, padding: 60, fontSize: 14 }}>Cargando…</div>}

                {!loading && filtered.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                    <div style={{ color: t.faint, fontSize: 15 }}>{returns.length === 0 ? 'No hay devoluciones todavía' : 'Sin resultados para este filtro'}</div>
                  </div>
                )}

                {!loading && filtered.map((ret, i) => {
                  const s = STATUS_META[ret.status] ?? { label: ret.status, fg: t.dim, bg: t.head, dot: t.faint };
                  const amount = ret.type === 'EXCHANGE'
                    ? (ret.totalAmount ?? 0)
                    : (ret.shopifyRefundAmount ?? ret.refundAmount ?? ret.totalAmount ?? 0);
                  const amountLabel = ret.type === 'EXCHANGE'
                    ? (amount > 0 ? `+${amount.toFixed(2)}€` : '—')
                    : (amount > 0 ? `−${amount.toFixed(2)}€` : '—');
                  const amountColor = amount <= 0 ? t.faint : ret.type === 'EXCHANGE' ? '#f0b429' : ACCENT;
                  const initials = ret.customerName.split(' ').map(n => n[0]).slice(0, 2).join('');
                  const urgent = ret.status === 'REQUESTED';
                  return (
                    <div key={ret.id} className="ad-row" onClick={() => window.location.href = `/admin/devoluciones/${ret.id}`}
                      style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px 115px 150px 80px', padding: '13px 20px', alignItems: 'center', borderTop: i === 0 ? 'none' : `1px solid ${t.borderSoft}`, cursor: 'pointer', transition: 'background .12s' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 650, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{ret.shopifyOrderNumber}</span>
                          {urgent && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e06a6a', boxShadow: '0 0 6px #e06a6a' }} />}
                        </div>
                        <div style={{ fontSize: 11, color: t.faint, marginTop: 1 }}>{ret.items.length} artículo{ret.items.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: `${AV[i % AV.length]}22`, border: `1px solid ${AV[i % AV.length]}44`, color: AV[i % AV.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700 }}>{initials}</div>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 500, color: t.text }}>{ret.customerName}</div>
                          <div style={{ fontSize: 12, color: t.dim }}>{ret.customerEmail}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12.5, color: t.dim }}>{timeAgo(ret.updatedAt ?? ret.createdAt)}</div>
                      <div>
                        <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 8, background: ret.type === 'EXCHANGE' ? 'rgba(155,140,219,0.12)' : 'rgba(91,155,213,0.12)', color: ret.type === 'EXCHANGE' ? '#9b8cdb' : '#5b9bd5' }}>{ret.type === 'EXCHANGE' ? 'Cambio' : 'Devolución'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 100, color: s.fg, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, boxShadow: `0 0 6px ${s.dot}aa` }} />{s.label}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 650, color: amountColor, fontVariantNumeric: 'tabular-nums' }}>{amountLabel}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── CONFIG ── */}
          {tab === 'config' && configDraft && !loading && (
            <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 16, padding: 28, maxWidth: 720, boxShadow: t.shadow, backdropFilter: 'blur(14px)', animation: 'fu .4s ease both' }}>
              <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: t.text }}>Configuración del sistema</h2>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: t.head, border: `1px solid ${t.border}`, borderRadius: 12, marginBottom: 20, cursor: 'pointer' }}>
                <input type="checkbox" checked={configDraft.enabled} onChange={e => setDraft({ ...configDraft, enabled: e.target.checked })} style={{ width: 18, height: 18, accentColor: ACCENT }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: t.text }}>Sistema de devoluciones activo</div>
                  <div style={{ fontSize: 12, color: t.dim }}>Desactiva para pausar el portal completamente</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 100, background: configDraft.enabled ? 'rgba(63,185,138,0.14)' : 'rgba(224,106,106,0.14)', color: configDraft.enabled ? '#3fb98a' : '#e06a6a' }}>{configDraft.enabled ? 'Activo' : 'Pausado'}</span>
              </label>
              <div style={{ height: 1, background: t.border, margin: '0 0 20px' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <label style={cfgLabel}><span>Plazo de devolución (días)</span>
                  <input type="number" min={1} max={365} style={inp} value={configDraft.windowDays} onChange={e => setDraft({ ...configDraft, windowDays: Number(e.target.value) })} /></label>
                <label style={cfgLabel}><span>Precio etiqueta (€)</span>
                  <input type="number" step="0.01" min={0} style={inp} value={configDraft.labelPrice} onChange={e => setDraft({ ...configDraft, labelPrice: Number(e.target.value) })} /></label>
                <label style={cfgLabel}><span>Política de cambios</span>
                  <select style={inp} value={configDraft.exchangePolicy} onChange={e => setDraft({ ...configDraft, exchangePolicy: e.target.value as ReturnConfig['exchangePolicy'] })}>
                    <option value="ANY">Cualquier producto</option><option value="SAME_TYPE">Mismo tipo</option><option value="VARIANT_ONLY">Solo otra variante</option>
                  </select></label>
                <label style={cfgLabel}><span>Código SendCloud retorno</span>
                  <input type="text" style={inp} value={configDraft.shippingProductCode ?? ''} placeholder="correos:paqretorno" onChange={e => setDraft({ ...configDraft, shippingProductCode: e.target.value || null })} /></label>
              </div>
              <label style={{ ...cfgLabel, marginBottom: 24 }}><span>Texto términos legales (opcional)</span>
                <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} value={configDraft.termsText ?? ''} onChange={e => setDraft({ ...configDraft, termsText: e.target.value || null })} placeholder="Se mostrará al cliente en el portal…" /></label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setDraft(config)} style={btnSecondary}>Descartar</button>
                <button onClick={saveConfig} disabled={savingConfig || JSON.stringify(config) === JSON.stringify(configDraft)} style={{ ...btnPrimary, flex: 1, opacity: (savingConfig || JSON.stringify(config) === JSON.stringify(configDraft)) ? 0.5 : 1 }}>{savingConfig ? 'Guardando…' : 'Guardar cambios'}</button>
              </div>
            </div>
          )}

          {/* ── BRANDING ── */}
          {tab === 'branding' && portalDraft && !loading && (
            <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 16, padding: 28, maxWidth: 720, boxShadow: t.shadow, backdropFilter: 'blur(14px)', animation: 'fu .4s ease both' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: t.text }}>Personalización del portal</h2>
              <p style={{ margin: '0 0 24px', fontSize: 13, color: t.dim }}>Estos ajustes se aplican al portal público de devoluciones.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <label style={cfgLabel}><span>Título del portal</span><input type="text" style={inp} value={portalDraft.titleText} onChange={e => setPortalDraft({ ...portalDraft, titleText: e.target.value })} /></label>
                <label style={cfgLabel}><span>Subtítulo</span><input type="text" style={inp} value={portalDraft.subtitleText} onChange={e => setPortalDraft({ ...portalDraft, subtitleText: e.target.value })} /></label>
                <label style={cfgLabel}><span>Color principal</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={portalDraft.primaryColor} onChange={e => setPortalDraft({ ...portalDraft, primaryColor: e.target.value })} style={{ width: 42, height: 40, border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', padding: 2, background: t.inputBg }} />
                    <input type="text" style={{ ...inp, flex: 1 }} value={portalDraft.primaryColor} onChange={e => setPortalDraft({ ...portalDraft, primaryColor: e.target.value })} />
                  </div></label>
                <label style={cfgLabel}><span>Estilo tarjeta</span>
                  <select style={inp} value={portalDraft.cardStyle} onChange={e => setPortalDraft({ ...portalDraft, cardStyle: e.target.value })}><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
              </div>
              <div style={{ height: 1, background: t.border, margin: '4px 0 20px' }} />
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: t.text2 }}>Imágenes y favicon</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <label style={cfgLabel}><span>URL del logo</span><input type="url" style={inp} value={portalDraft.logoUrl ?? ''} placeholder="https://…" onChange={e => setPortalDraft({ ...portalDraft, logoUrl: e.target.value || null })} /></label>
                <label style={cfgLabel}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>URL del favicon{portalDraft.faviconUrl && <img src={portalDraft.faviconUrl} alt="" style={{ width: 16, height: 16, borderRadius: 2 }} />}</span>
                  <input type="url" style={inp} value={portalDraft.faviconUrl ?? ''} placeholder="https://…/favicon.png" onChange={e => setPortalDraft({ ...portalDraft, faviconUrl: e.target.value || null })} /></label>
                <label style={cfgLabel}><span>URL imagen de fondo</span><input type="url" style={inp} value={portalDraft.backgroundUrl ?? ''} placeholder="https://…" onChange={e => setPortalDraft({ ...portalDraft, backgroundUrl: e.target.value || null })} /></label>
                <label style={cfgLabel}><span>URL política / términos</span><input type="url" style={inp} value={portalDraft.policyUrl ?? ''} placeholder="https://…" onChange={e => setPortalDraft({ ...portalDraft, policyUrl: e.target.value || null })} /></label>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button onClick={() => setPortalDraft(portalCfg)} style={btnSecondary}>Descartar</button>
                <button onClick={saveBranding} disabled={savingPortal || JSON.stringify(portalCfg) === JSON.stringify(portalDraft)} style={{ ...btnPrimary, flex: 1, opacity: (savingPortal || JSON.stringify(portalCfg) === JSON.stringify(portalDraft)) ? 0.5 : 1 }}>{savingPortal ? 'Guardando…' : 'Guardar personalización'}</button>
              </div>
            </div>
          )}

          {/* ── EXCEPTIONS ── */}
          {tab === 'exceptions' && !loading && (
            <div style={{ animation: 'fu .4s ease both' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 14, color: t.dim }}>{exceptions.length} excepcion{exceptions.length !== 1 ? 'es' : ''}</div>
                <button onClick={() => setShowNewEx(true)} style={btnPrimary}>+ Nueva excepción</button>
              </div>
              {exceptions.length === 0 ? (
                <div style={{ textAlign: 'center', color: t.faint, padding: 80, background: t.card, border: `1px solid ${t.border}`, borderRadius: 16, boxShadow: t.shadow }}>
                  Sin excepciones. Crea una para extender plazos, regalar etiquetas o bloquear devoluciones.
                </div>
              ) : (
                <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 16, overflow: 'hidden', boxShadow: t.shadow, backdropFilter: 'blur(14px)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: t.head, fontSize: 10.5, textTransform: 'uppercase', color: t.faint, letterSpacing: '0.06em' }}>
                        {['Match', 'Tipo', 'Detalle', 'Expira', 'Estado', ''].map((h, i) => <th key={i} style={{ padding: '11px 16px', textAlign: 'left', fontWeight: 600 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {exceptions.map((ex, i) => {
                        const meta = EXCEPTION_LABELS[ex.type] ?? { label: ex.type, color: t.dim };
                        return (
                          <tr key={ex.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${t.borderSoft}`, fontSize: 14 }}>
                            <td style={{ padding: '13px 16px' }}>
                              {ex.orderNumber && <div style={{ fontWeight: 600, color: t.text }}>{ex.orderNumber}</div>}
                              {ex.customerEmail && <div style={{ fontSize: 12, color: t.dim }}>{ex.customerEmail}</div>}
                            </td>
                            <td style={{ padding: '13px 16px' }}><span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span></td>
                            <td style={{ padding: '13px 16px', color: t.text2 }}>
                              {ex.type === 'EXTEND_WINDOW' && <span>+{ex.extraDays} días</span>}
                              {ex.notes && <div style={{ fontSize: 12, color: t.dim }}>{ex.notes}</div>}
                            </td>
                            <td style={{ padding: '13px 16px', fontSize: 12, color: t.faint }}>{ex.expiresAt ? new Date(ex.expiresAt).toLocaleDateString('es-ES') : '—'}</td>
                            <td style={{ padding: '13px 16px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                <input type="checkbox" checked={ex.active} onChange={e => toggleException(ex.id, e.target.checked)} style={{ accentColor: ACCENT }} />
                                <span style={{ fontSize: 12, color: ex.active ? '#3fb98a' : t.faint }}>{ex.active ? 'Activa' : 'Inactiva'}</span>
                              </label>
                            </td>
                            <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                              <button onClick={() => deleteException(ex.id)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 500, background: 'rgba(224,106,106,0.08)', border: '1px solid rgba(224,106,106,0.3)', color: '#e06a6a', borderRadius: 8, cursor: 'pointer', fontFamily: FONT }}>Borrar</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {showNewEx && (
                <div onClick={() => setShowNewEx(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100, animation: 'fi .15s ease both' }}>
                  <div onClick={e => e.stopPropagation()} style={{ background: t.drawer, borderRadius: 16, width: '100%', maxWidth: 480, padding: 28, boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)', border: `1px solid ${t.border}` }}>
                    <h3 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700, color: t.text }}>Nueva excepción</h3>
                    {[
                      { label: 'Tipo', content: (<select style={inp} value={newEx.type} onChange={e => setNewEx({ ...newEx, type: e.target.value })}><option value="EXTEND_WINDOW">Ampliar plazo</option><option value="FREE_LABEL">Etiqueta gratis</option><option value="ACCEPT_EXPIRED">Aceptar fuera de plazo</option><option value="BLOCK">Bloquear devolución</option></select>) },
                      { label: 'Número de pedido (opcional)', content: (<input type="text" style={inp} placeholder="#12345" value={newEx.orderNumber} onChange={e => setNewEx({ ...newEx, orderNumber: e.target.value })} />) },
                      { label: 'Email cliente (opcional)', content: (<input type="email" style={inp} placeholder="cliente@email.com" value={newEx.customerEmail} onChange={e => setNewEx({ ...newEx, customerEmail: e.target.value })} />) },
                      ...(newEx.type === 'EXTEND_WINDOW' ? [{ label: 'Días extra', content: (<input type="number" min={1} max={365} style={inp} value={newEx.extraDays} onChange={e => setNewEx({ ...newEx, extraDays: Number(e.target.value) })} />) }] : []),
                      { label: 'Notas internas', content: (<input type="text" style={inp} placeholder="Ej: cliente VIP, error nuestro…" value={newEx.notes} onChange={e => setNewEx({ ...newEx, notes: e.target.value })} />) },
                      { label: 'Expira (opcional)', content: (<input type="date" style={inp} value={newEx.expiresAt} onChange={e => setNewEx({ ...newEx, expiresAt: e.target.value })} />) },
                    ].map((row, i) => (
                      <label key={i} style={{ ...cfgLabel, marginBottom: 14 }}><span>{row.label}</span>{row.content}</label>
                    ))}
                    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                      <button onClick={() => setShowNewEx(false)} style={btnSecondary}>Cancelar</button>
                      <button onClick={createException} style={{ ...btnPrimary, flex: 1 }}>Crear excepción</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {loading && tab !== 'list' && <div style={{ textAlign: 'center', color: t.faint, padding: 60 }}>Cargando…</div>}
        </div>
      </div>
    </div>
  );
}
