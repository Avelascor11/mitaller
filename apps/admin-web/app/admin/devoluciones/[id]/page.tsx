'use client';

import { use, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const ACCENT  = '#34B27B';
const ACCENT2 = '#2A9D8F';
const FONT    = "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif";
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

const STATUS_META: Record<string, { label: string; fg: string; bg: string; dot: string }> = {
  REQUESTED:     { label: 'En espera',        fg: '#f0b429', bg: 'rgba(240,180,41,0.12)',  dot: '#f0b429' },
  LABEL_CREATED: { label: 'Etiqueta enviada', fg: '#5b9bd5', bg: 'rgba(91,155,213,0.12)',  dot: '#5b9bd5' },
  RECEIVED:      { label: 'Por revisar',      fg: '#9b8cdb', bg: 'rgba(155,140,219,0.12)', dot: '#9b8cdb' },
  APPROVED:      { label: 'Aprobada',         fg: '#3fb98a', bg: 'rgba(63,185,138,0.12)',  dot: '#3fb98a' },
  REJECTED:      { label: 'Rechazada',        fg: '#e06a6a', bg: 'rgba(224,106,106,0.12)', dot: '#e06a6a' },
  CANCELLED:     { label: 'Cancelada',        fg: '#8A8A96', bg: 'rgba(138,138,150,0.12)', dot: '#8A8A96' },
};

const REASON_LABELS: Record<string, string> = {
  WRONG_SIZE:       'Talla incorrecta',
  DEFECTIVE:        'Defectuoso',
  NOT_AS_DESCRIBED: 'No coincide con descripción',
  CHANGED_MIND:     'Cambio de opinión',
  WRONG_ITEM:       'Artículo incorrecto',
  OTHER:            'Otro motivo',
};

function makeTheme(dark: boolean) {
  return dark
    ? { dark: true,  text: '#ECECEF', text2: '#B4B4BE', dim: '#7C7C88', faint: '#56565F', card: 'rgba(255,255,255,0.025)', cardSolid: '#16161C', border: 'rgba(255,255,255,0.08)', borderSoft: 'rgba(255,255,255,0.05)', head: 'rgba(255,255,255,0.02)', hover: 'rgba(255,255,255,0.04)', inputBg: 'rgba(255,255,255,0.04)', bgBase: '#08080B', shadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 48px -16px rgba(0,0,0,0.65)', side: 'rgba(255,255,255,0.015)' }
    : { dark: false, text: '#15171C', text2: '#3C4049', dim: '#6B7280', faint: '#9AA0AA', card: 'rgba(255,255,255,0.9)', cardSolid: '#FFFFFF', border: 'rgba(20,22,28,0.08)', borderSoft: 'rgba(20,22,28,0.05)', head: 'rgba(20,22,28,0.02)', hover: 'rgba(20,22,28,0.025)', inputBg: '#FFFFFF', bgBase: '#EEF0F3', shadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 40px -16px rgba(20,22,28,0.16)', side: 'rgba(255,255,255,0.6)' };
}

interface ReturnRecord {
  id: string;
  shopifyOrderNumber: string;
  customerName: string;
  customerEmail: string;
  status: string;
  type: string;
  paymentStatus: string;
  checkoutUrl?: string | null;
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
  verificationNotes?: string | null;
  refundedAt?: string | null;
  shopifyRefundAmount?: number | null;
  order: {
    orderNumber: string;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    shippingAddressJson?: unknown;
    totalPrice?: number | null;
    createdAt?: string;
  };
  items: Array<{
    id: string;
    quantity: number;
    reason: string;
    notes?: string | null;
    replacementTitle?: string | null;
    replacementPrice?: number | null;
    orderItem: {
      title: string;
      variantTitle?: string | null;
      sku: string;
      imageUrl?: string | null;
      price?: number | null;
    };
  }>;
}

interface Toast { id: number; msg: string; ok: boolean }

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ctr = useRef(0);
  function push(msg: string, ok = true) {
    const id = ++ctr.current;
    setToasts(t => [...t, { id, msg, ok }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }
  return { toasts, ok: (m: string) => push(m, true), err: (m: string) => push(m, false) };
}

function Icon({ d, size = 16, c, sw = 1.7 }: { d: string; size?: number; c: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const ICONS = {
  back:    'M19 12H5|M12 5l-7 7 7 7',
  refresh: 'M23 4v6h-6|M1 20v-6h6|M3.51 9a9 9 0 0 1 14.85-3.36L23 10|M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  check:   'M20 6L9 17l-5-5',
  x:       'M18 6L6 18|M6 6l12 12',
  label:   'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z|M7 7h.01',
  receive: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
  link:    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71|M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  download:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3',
  camera:  'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z|M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  moon:    'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  sun:     'M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z',
  logout:  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9',
};

function parseAddress(value: unknown): string {
  if (!value) return '—';
  let address = value;
  if (typeof value === 'string') {
    try { address = JSON.parse(value); } catch { return value; }
  }
  if (!address || typeof address !== 'object') return String(address);
  const a = address as Record<string, unknown>;
  return [a.address1, a.address2, a.city, a.province, a.zip, a.country ?? a.countryCodeV2]
    .filter((p): p is string => typeof p === 'string' && !!p).join(', ') || '—';
}

function PhotoSection({ returnId, token, t }: { returnId: string; token: string; t: ReturnType<typeof makeTheme> }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/returns/${returnId}/photos`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setPhotos(d.map((p: { data: string }) => p.data))).catch(() => {});
  }, [returnId, token]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const data = reader.result as string;
      await fetch(`${API_URL}/returns/${returnId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
      setPhotos(p => [...p, data]); setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ padding: '16px 20px' }}>
      <AnimatePresence>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: photos.length > 0 ? 12 : 0 }}>
          {photos.map((src, i) => (
            <motion.img key={i} src={src} alt={`foto ${i+1}`}
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', damping: 18, stiffness: 280 }}
              whileHover={{ scale: 1.06, zIndex: 10 }}
              onClick={() => window.open(src, '_blank')}
              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: `1px solid ${t.border}`, cursor: 'pointer', position: 'relative' }}
            />
          ))}
          {photos.length === 0 && <span style={{ fontSize: 13, color: t.faint }}>Sin fotos adjuntas</span>}
        </div>
      </AnimatePresence>
      <motion.label whileHover={{ scale: 1.02, borderColor: ACCENT + '66' }} whileTap={{ scale: 0.97 }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', background: t.head, border: `1px solid ${t.border}`, borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 500, color: t.dim, marginTop: 4 }}>
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
        <Icon d={ICONS.camera} size={14} c={t.dim} />
        {uploading ? 'Subiendo…' : 'Añadir foto'}
      </motion.label>
    </div>
  );
}

// ─── Variants ────────────────────────────────────────────────
const tabVariants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

const colVariants = {
  animate: { transition: { staggerChildren: 0.07 } },
};

const cardV = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE } },
};

const sideV = {
  initial: { opacity: 0, x: 18 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.32, ease: EASE } },
};

const timelineV = {
  initial: { opacity: 0, x: -10 },
  animate: (i: number) => ({ opacity: 1, x: 0, transition: { delay: i * 0.09 + 0.2, duration: 0.26, ease: EASE } }),
};

export default function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dark, setDark] = useState(true);
  const [token, setToken] = useState('');
  const [data, setData] = useState<ReturnRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState('');
  const { toasts, ok, err } = useToast();

  const t = makeTheme(dark);

  useEffect(() => {
    const storedTheme = localStorage.getItem('admin-theme');
    if (storedTheme) setDark(storedTheme === 'dark');
    const stored = localStorage.getItem('token') || localStorage.getItem('mitaller_token');
    if (!stored) { window.location.href = '/login'; return; }
    setToken(stored);
    loadReturn(stored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { localStorage.setItem('admin-theme', dark ? 'dark' : 'light'); }, [dark]);

  function auth(tk: string) { return { Authorization: `Bearer ${tk}` }; }

  async function loadReturn(jwt: string) {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/returns/${id}`, { headers: auth(jwt) });
      if (r.status === 401) { window.location.href = '/login'; return; }
      if (r.status === 404) { setNotFound(true); return; }
      setData(await r.json());
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }

  async function updateStatus(status: string) {
    if (!data) return;
    setActionLoading(true);
    try {
      if (status === 'LABEL_CREATED') {
        const res = await fetch(`${API_URL}/returns/${data.id}/generate-label`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) } });
        const d = await res.json();
        if (!res.ok) throw new Error(d.message ?? 'Error generando etiqueta');
        ok('Etiqueta generada ✓');
      } else if (status === 'RECEIVED') {
        const res = await fetch(`${API_URL}/returns/${data.id}/received`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) } });
        if (!res.ok) throw new Error((await res.json()).message ?? 'Error');
        ok('Marcada como recibida ✓');
      } else {
        const res = await fetch(`${API_URL}/returns/${data.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ status }) });
        if (!res.ok) throw new Error((await res.json()).message ?? 'Error');
        ok(`Estado → ${STATUS_META[status]?.label ?? status} ✓`);
      }
      loadReturn(token);
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
    finally { setActionLoading(false); }
  }

  async function verifyReturn(verificationStatus: 'OK' | 'ISSUE') {
    if (!data) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/returns/${data.id}/verify`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ verificationStatus, verificationNotes: verifyNotes || undefined }) });
      if (!res.ok) throw new Error('Error verificando');
      ok(verificationStatus === 'OK' ? 'Verificación correcta ✓' : 'Incidencia registrada');
      loadReturn(token);
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
    finally { setActionLoading(false); }
  }

  const mesh = dark
    ? `radial-gradient(900px 500px at 12% -8%, rgba(52,178,123,0.10), transparent 60%), radial-gradient(800px 600px at 100% 0%, rgba(91,120,213,0.08), transparent 55%)`
    : `radial-gradient(900px 500px at 12% -8%, rgba(52,178,123,0.12), transparent 60%), radial-gradient(800px 600px at 100% 0%, rgba(91,120,213,0.10), transparent 55%)`;

  const inp: React.CSSProperties = { padding: '9px 13px', borderRadius: 9, border: `1px solid ${t.border}`, fontSize: 13, color: t.text, background: t.inputBg, outline: 'none', width: '100%', fontFamily: FONT };

  if (!token && !loading) return null;

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bgBase, fontFamily: FONT }}>
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: 'center' }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          style={{ width: 32, height: 32, border: `3px solid ${t.border}`, borderTopColor: ACCENT, borderRadius: '50%', margin: '0 auto 12px' }} />
        <div style={{ fontSize: 14, color: t.faint }}>Cargando devolución…</div>
      </motion.div>
    </div>
  );

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: t.bgBase, fontFamily: FONT }}>
      <div style={{ position: 'fixed', inset: 0, backgroundImage: mesh, pointerEvents: 'none' }} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>🔍</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.text }}>Devolución no encontrada</div>
        <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
          onClick={() => window.location.href = '/admin/devoluciones'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.dim, background: t.card, border: `1px solid ${t.border}`, borderRadius: 9, padding: '9px 16px', cursor: 'pointer', fontFamily: FONT, backdropFilter: 'blur(14px)' }}>
          <Icon d={ICONS.back} size={14} c={t.dim} /> Volver al listado
        </motion.button>
      </motion.div>
    </div>
  );

  if (!data) return null;

  const sm = STATUS_META[data.status] ?? { label: data.status, fg: t.dim, bg: t.head, dot: t.faint };
  const refundAmt = data.shopifyRefundAmount ?? data.refundAmount ?? data.totalAmount;
  const shippingAddr = parseAddress(data.order.shippingAddressJson);

  const GlassCard = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ borderRadius: 16, background: t.card, border: `1px solid ${t.border}`, boxShadow: t.shadow, backdropFilter: 'blur(14px)', overflow: 'hidden', ...style }}>
      {children}
    </div>
  );

  const SectionHead = ({ icon, title }: { icon: string; title: string }) => (
    <div style={{ padding: '14px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: t.faint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{title}</span>
    </div>
  );

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '9px 0', borderBottom: `1px solid ${t.borderSoft}` }}>
      <span style={{ fontSize: 12, color: t.faint, fontWeight: 500, flexShrink: 0, marginRight: 16 }}>{label}</span>
      <span style={{ fontSize: 13, color: t.text, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: t.bgBase, fontFamily: FONT, color: t.text, transition: 'background .45s, color .3s' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        input:focus,select:focus,textarea:focus { border-color:${ACCENT}88 !important; box-shadow:0 0 0 3px ${ACCENT}1f !important; outline:none }
        ::placeholder { color:${t.faint} }
        .det-btn { transition: filter .15s, transform .15s }
        .det-btn:hover { filter: brightness(1.06) }
        .det-btn:active { transform: scale(.96) }
      `}</style>

      {/* Backgrounds */}
      <div style={{ position: 'fixed', inset: 0, backgroundImage: mesh, pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, backgroundImage: GRAIN, opacity: dark ? 0.045 : 0.03, mixBlendMode: dark ? 'screen' : 'multiply', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, backgroundImage: `linear-gradient(${dark ? 'rgba(255,255,255,0.016)' : 'rgba(20,22,28,0.018)'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? 'rgba(255,255,255,0.016)' : 'rgba(20,22,28,0.018)'} 1px, transparent 1px)`, backgroundSize: '44px 44px', pointerEvents: 'none', zIndex: 0 }} />

      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 999 }}>
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div key={toast.id}
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1, transition: { type: 'spring' as const, damping: 20, stiffness: 300 } }}
              exit={{ opacity: 0, x: 40, scale: 0.9, transition: { duration: 0.18 } }}
              style={{ padding: '12px 18px', borderRadius: 11, fontSize: 14, fontWeight: 600, background: toast.ok ? `linear-gradient(140deg,${ACCENT},${ACCENT2})` : '#e06a6a', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}
            >{toast.msg}</motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── TOP NAV ── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
        style={{ position: 'sticky', top: 0, zIndex: 50, background: t.side, backdropFilter: 'blur(20px)', borderBottom: `1px solid ${t.border}`, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <motion.button whileHover={{ x: -3 }} whileTap={{ scale: 0.96 }}
            onClick={() => window.location.href = '/admin/devoluciones'}
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: t.dim, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT, padding: 0 }}>
            <Icon d={ICONS.back} size={15} c={t.dim} />
            <span>Devoluciones</span>
          </motion.button>

          <span style={{ width: 1, height: 16, background: t.border, display: 'block' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: t.text }}>{data.shopifyOrderNumber}</span>

            <AnimatePresence mode="wait">
              <motion.span key={data.status}
                initial={{ opacity: 0, scale: 0.82, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.82, y: -4 }}
                transition={{ type: 'spring' as const, damping: 18, stiffness: 320 }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650, padding: '4px 12px', borderRadius: 100, color: sm.fg, background: sm.bg }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: sm.dot, boxShadow: `0 0 6px ${sm.dot}aa` }} />
                {sm.label}
              </motion.span>
            </AnimatePresence>

            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 8, background: data.type === 'EXCHANGE' ? 'rgba(155,140,219,0.14)' : 'rgba(91,155,213,0.14)', color: data.type === 'EXCHANGE' ? '#9b8cdb' : '#5b9bd5' }}>
              {data.type === 'EXCHANGE' ? '⇄ Cambio' : '↩ Devolución'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data.status !== 'APPROVED' && data.status !== 'REJECTED' && data.status !== 'CANCELLED' && (
            <motion.button whileHover={{ y: -2, boxShadow: `0 10px 22px -8px ${ACCENT}99` }} whileTap={{ scale: 0.96 }}
              disabled={actionLoading} onClick={() => updateStatus('APPROVED')}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 15px', background: `linear-gradient(140deg,${ACCENT},${ACCENT2})`, color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionLoading ? 0.5 : 1, fontFamily: FONT, boxShadow: `0 6px 16px -6px ${ACCENT}88` }}>
              <Icon d={ICONS.check} size={14} c="#fff" /> Aprobar
            </motion.button>
          )}
          {data.status !== 'REJECTED' && data.status !== 'CANCELLED' && data.status !== 'APPROVED' && (
            <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }}
              disabled={actionLoading} onClick={() => updateStatus('REJECTED')}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 15px', background: 'rgba(224,106,106,0.1)', color: '#e06a6a', border: '1px solid rgba(224,106,106,0.3)', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionLoading ? 0.5 : 1, fontFamily: FONT }}>
              <Icon d={ICONS.x} size={14} c="#e06a6a" /> Rechazar
            </motion.button>
          )}
          <motion.button whileHover={{ rotate: 180 }} transition={{ duration: 0.4 }}
            onClick={() => loadReturn(token)}
            style={{ width: 36, height: 36, borderRadius: 9, background: t.card, border: `1px solid ${t.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(14px)' }}>
            <Icon d={ICONS.refresh} size={14} c={t.dim} />
          </motion.button>
          <button onClick={() => setDark(d => !d)}
            style={{ width: 36, height: 36, borderRadius: 9, background: t.card, border: `1px solid ${t.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(14px)' }}>
            <Icon d={dark ? ICONS.sun : ICONS.moon} size={14} c={t.dim} />
          </button>
        </div>
      </motion.div>

      {/* ── CONTENT ── */}
      <motion.div variants={tabVariants} initial="initial" animate="animate"
        style={{ position: 'relative', zIndex: 2, maxWidth: 1240, margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18, alignItems: 'start' }}>

        {/* LEFT COLUMN */}
        <motion.div variants={colVariants} initial="animate" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Artículos */}
          <motion.div variants={cardV}>
            <GlassCard>
              <SectionHead icon="📦" title="Artículos solicitados" />
              <div>
                {data.items.map((item, i) => (
                  <motion.div key={item.id} custom={i} variants={timelineV} initial="initial" animate="animate"
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px', borderBottom: i < data.items.length - 1 ? `1px solid ${t.borderSoft}` : 'none' }}>
                    {item.orderItem.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <motion.img whileHover={{ scale: 1.06 }} src={item.orderItem.imageUrl} alt=""
                        style={{ width: 58, height: 58, objectFit: 'cover', borderRadius: 10, border: `1px solid ${t.border}`, flexShrink: 0, cursor: 'pointer' }} />
                    ) : (
                      <div style={{ width: 58, height: 58, borderRadius: 10, background: t.head, border: `1px solid ${t.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📷</div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
                        {item.orderItem.title}
                        {item.orderItem.variantTitle && <span style={{ color: t.dim, fontWeight: 400 }}> — {item.orderItem.variantTitle}</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>SKU: {item.orderItem.sku}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 8, background: t.head, color: t.dim }}>
                          {REASON_LABELS[item.reason] ?? item.reason}
                        </span>
                        {item.replacementTitle && (
                          <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 8, background: 'rgba(155,140,219,0.12)', color: '#9b8cdb' }}>
                            → {item.replacementTitle}{item.replacementPrice != null ? ` (${item.replacementPrice.toFixed(2)}€)` : ''}
                          </span>
                        )}
                      </div>
                      {item.notes && <div style={{ fontSize: 12, color: t.faint, marginTop: 5, fontStyle: 'italic' }}>"{item.notes}"</div>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>×{item.quantity}</div>
                      {item.orderItem.price != null && <div style={{ fontSize: 12, color: t.faint, marginTop: 2 }}>{item.orderItem.price.toFixed(2)}€</div>}
                    </div>
                  </motion.div>
                ))}
              </div>
              {data.notes && (
                <div style={{ padding: '12px 20px', background: 'rgba(240,180,41,0.06)', borderTop: `1px solid rgba(240,180,41,0.2)` }}>
                  <span style={{ fontSize: 12, color: '#f0b429' }}>💬 Nota del cliente: </span>
                  <span style={{ fontSize: 13, color: t.text2 }}>{data.notes}</span>
                </div>
              )}
            </GlassCard>
          </motion.div>

          {/* Verificación */}
          <motion.div variants={cardV}>
            <GlassCard>
              <SectionHead icon="🔍" title="Verificación del paquete" />
              <div style={{ padding: '16px 20px' }}>
                <AnimatePresence mode="wait">
                  {data.verificationStatus ? (
                    <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: data.verificationNotes ? 12 : 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, padding: '5px 14px', borderRadius: 100,
                          background: data.verificationStatus === 'OK' ? 'rgba(63,185,138,0.14)' : 'rgba(224,106,106,0.14)',
                          color: data.verificationStatus === 'OK' ? '#3fb98a' : '#e06a6a' }}>
                          {data.verificationStatus === 'OK' ? '✅ Todo correcto' : '⚠️ Incidencia detectada'}
                        </span>
                        {data.verifiedAt && <span style={{ fontSize: 12, color: t.faint }}>{new Date(data.verifiedAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                      </div>
                      {data.verificationNotes && (
                        <div style={{ fontSize: 13, color: t.text2, padding: '10px 14px', background: t.head, borderRadius: 9, marginTop: 10 }}>{data.verificationNotes}</div>
                      )}
                    </motion.div>
                  ) : data.status === 'RECEIVED' ? (
                    <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
                      <p style={{ margin: '0 0 12px', fontSize: 13, color: t.text2 }}>Paquete recibido. ¿El contenido es correcto?</p>
                      <input type="text" placeholder="Notas de verificación (opcional)" value={verifyNotes} onChange={e => setVerifyNotes(e.target.value)} style={{ ...inp, marginBottom: 10 }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => verifyReturn('OK')} disabled={actionLoading}
                          style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600, background: 'rgba(63,185,138,0.12)', color: '#3fb98a', border: '1px solid rgba(63,185,138,0.3)', borderRadius: 9, cursor: 'pointer', opacity: actionLoading ? 0.5 : 1, fontFamily: FONT }}>
                          ✅ Todo correcto
                        </motion.button>
                        <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => verifyReturn('ISSUE')} disabled={actionLoading}
                          style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600, background: 'rgba(224,106,106,0.10)', color: '#e06a6a', border: '1px solid rgba(224,106,106,0.3)', borderRadius: 9, cursor: 'pointer', opacity: actionLoading ? 0.5 : 1, fontFamily: FONT }}>
                          ⚠️ Hay incidencia
                        </motion.button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      style={{ fontSize: 13, color: t.faint, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>⏳</span>
                      {data.receivedAt
                        ? `Recibido el ${new Date(data.receivedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}`
                        : 'Pendiente de recibir el paquete'}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </GlassCard>
          </motion.div>

          {/* Fotos */}
          <motion.div variants={cardV}>
            <GlassCard>
              <SectionHead icon="📸" title="Evidencia fotográfica" />
              <PhotoSection returnId={data.id} token={token} t={t} />
            </GlassCard>
          </motion.div>

          {/* Timeline */}
          <motion.div variants={cardV}>
            <GlassCard>
              <SectionHead icon="🕐" title="Historial de la solicitud" />
              <div style={{ padding: '16px 20px' }}>
                {[
                  { date: data.createdAt,  label: 'Solicitud creada',           icon: '📋', active: true },
                  { date: data.receivedAt, label: 'Paquete recibido',            icon: '📦', active: !!data.receivedAt },
                  { date: data.verifiedAt, label: data.verificationStatus === 'ISSUE' ? 'Verificación: incidencia' : 'Verificación correcta', icon: data.verificationStatus === 'ISSUE' ? '⚠️' : '✅', active: !!data.verifiedAt },
                  { date: data.refundedAt, label: `Reembolso${refundAmt ? ` · ${refundAmt.toFixed(2)}€` : ''}`, icon: '💰', active: !!data.refundedAt },
                ].map((ev, i) => (
                  <motion.div key={i} custom={i} variants={timelineV} initial="initial" animate="animate"
                    style={{ display: 'flex', gap: 14, marginBottom: i < 3 ? 14 : 0, opacity: ev.active ? 1 : 0.3 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <motion.div initial={{ scale: 0.6 }} animate={{ scale: ev.active ? 1 : 0.85 }} transition={{ delay: i * 0.1 + 0.35, type: 'spring' as const, damping: 16, stiffness: 260 }}
                        style={{ width: 30, height: 30, borderRadius: '50%', background: ev.active ? `rgba(52,178,123,0.12)` : t.head, border: `1px solid ${ev.active ? ACCENT + '44' : t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>
                        {ev.icon}
                      </motion.div>
                      {i < 3 && <div style={{ width: 1, flex: 1, minHeight: 16, background: ev.active ? ACCENT + '44' : t.border, margin: '5px 0' }} />}
                    </div>
                    <div style={{ paddingTop: 5, paddingBottom: i < 3 ? 10 : 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: ev.active ? 600 : 400, color: ev.active ? t.text : t.faint }}>{ev.label}</div>
                      {ev.date && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>{new Date(ev.date).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>}
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

        </motion.div>

        {/* RIGHT SIDEBAR */}
        <motion.div variants={colVariants} initial="animate" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Estado */}
          <motion.div variants={sideV}>
            <GlassCard>
              <SectionHead icon="🏷️" title="Estado" />
              <div style={{ padding: '16px 20px' }}>
                <AnimatePresence mode="wait">
                  <motion.div key={data.status} initial={{ opacity: 0, scale: 0.85, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85, y: -6 }}
                    transition={{ type: 'spring' as const, damping: 18, stiffness: 300 }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 650, padding: '6px 14px', borderRadius: 100, color: sm.fg, background: sm.bg, marginBottom: 14 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: sm.dot, boxShadow: `0 0 7px ${sm.dot}aa` }} />
                    {sm.label}
                  </motion.div>
                </AnimatePresence>

                {/* Refund banner */}
                {data.status === 'APPROVED' && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
                    style={{ padding: '10px 13px', borderRadius: 9, background: data.refundedAt ? 'rgba(63,185,138,0.1)' : 'rgba(240,180,41,0.08)', border: `1px solid ${data.refundedAt ? 'rgba(63,185,138,0.3)' : 'rgba(240,180,41,0.25)'}`, marginBottom: 14 }}>
                    {data.refundedAt ? (
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#3fb98a' }}>
                        ✓ Reembolso enviado · {refundAmt?.toFixed(2)}€
                        <div style={{ fontWeight: 400, color: '#3fb98a', opacity: 0.8, marginTop: 2, fontSize: 11.5 }}>
                          {new Date(data.refundedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#f0b429' }}>⏳ Reembolso pendiente en Shopify</div>
                    )}
                  </motion.div>
                )}

                {/* Payment pending */}
                {data.paymentStatus === 'PENDING' && data.checkoutUrl && (
                  <div style={{ padding: '10px 13px', borderRadius: 9, background: 'rgba(224,106,106,0.08)', border: '1px solid rgba(224,106,106,0.25)', marginBottom: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#e06a6a' }}>💳 Pago de etiqueta pendiente</div>
                    {data.totalAmount != null && data.totalAmount > 0 && <div style={{ fontSize: 14, fontWeight: 700, color: '#e06a6a', marginTop: 2 }}>{data.totalAmount.toFixed(2)}€</div>}
                    <a href={data.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, fontSize: 12, color: '#5b9bd5', textDecoration: 'none', fontWeight: 500 }}>
                      <Icon d={ICONS.link} size={12} c="#5b9bd5" /> Ver checkout ↗
                    </a>
                  </div>
                )}

                <div style={{ fontSize: 10.5, fontWeight: 700, color: t.faint, letterSpacing: '0.08em', marginBottom: 8 }}>CAMBIAR ESTADO</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {Object.entries(STATUS_META).filter(([k]) => k !== data.status).map(([key, meta]) => (
                    <motion.button key={key} whileHover={{ x: 3 }} whileTap={{ scale: 0.97 }}
                      onClick={() => updateStatus(key)} disabled={actionLoading}
                      style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: meta.fg, background: meta.bg, border: `1px solid ${meta.dot}33`, borderRadius: 9, textAlign: 'left', opacity: actionLoading ? 0.5 : 1, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.dot }} />
                      {meta.label}
                    </motion.button>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Cliente */}
          <motion.div variants={sideV}>
            <GlassCard>
              <SectionHead icon="👤" title="Cliente" />
              <div style={{ padding: '12px 20px' }}>
                <Row label="Nombre" value={data.customerName} />
                <Row label="Email" value={<a href={`mailto:${data.customerEmail}`} style={{ color: '#5b9bd5', textDecoration: 'none' }}>{data.customerEmail}</a>} />
                {data.order.customerPhone && <Row label="Teléfono" value={data.order.customerPhone} />}
                {shippingAddr !== '—' && <Row label="Dirección" value={shippingAddr} />}
              </div>
            </GlassCard>
          </motion.div>

          {/* Pedido original */}
          <motion.div variants={sideV}>
            <GlassCard>
              <SectionHead icon="🛒" title="Pedido original" />
              <div style={{ padding: '12px 20px' }}>
                <Row label="Nº pedido" value={<span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{data.shopifyOrderNumber}</span>} />
                {data.order.totalPrice != null && <Row label="Total pedido" value={`${data.order.totalPrice.toFixed(2)}€`} />}
                {data.order.createdAt && <Row label="Fecha compra" value={new Date(data.order.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })} />}
                <Row label="Solicitud" value={new Date(data.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />
              </div>
            </GlassCard>
          </motion.div>

          {/* Envío */}
          <motion.div variants={sideV}>
            <GlassCard>
              <SectionHead icon="🚚" title="Envío y seguimiento" />
              <div style={{ padding: '12px 20px' }}>
                {data.trackingNumber ? (
                  <>
                    <Row label="Tracking" value={<span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{data.trackingNumber}</span>} />
                    {data.carrier && <Row label="Transportista" value={data.carrier} />}
                    {data.labelUrl && (
                      <motion.a whileHover={{ y: -2, boxShadow: '0 8px 20px -8px rgba(0,0,0,0.4)' }}
                        href={data.labelUrl.startsWith('http') ? data.labelUrl : `${API_URL}${data.labelUrl}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, padding: '10px', background: `linear-gradient(140deg,${ACCENT},${ACCENT2})`, color: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, textDecoration: 'none', boxShadow: `0 6px 16px -6px ${ACCENT}88` }}>
                        <Icon d={ICONS.download} size={14} c="#fff" /> Descargar etiqueta
                      </motion.a>
                    )}
                    <motion.a whileHover={{ y: -1, borderColor: ACCENT + '55' }}
                      href={`/devoluciones/estado/${data.id}`} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, padding: '8px', background: t.head, border: `1px solid ${t.border}`, color: t.dim, borderRadius: 9, fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>
                      📍 Ver estado cliente ↗
                    </motion.a>
                  </>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: t.faint, marginBottom: data.status === 'REQUESTED' ? 12 : 0 }}>
                      {data.status === 'REQUESTED' ? 'Etiqueta pendiente de generar' : 'Sin tracking aún'}
                    </div>
                    {data.status === 'REQUESTED' && (
                      <motion.button whileHover={{ y: -2, boxShadow: `0 10px 22px -8px ${ACCENT}88` }} whileTap={{ scale: 0.97 }}
                        onClick={() => updateStatus('LABEL_CREATED')} disabled={actionLoading}
                        style={{ width: '100%', padding: '10px', background: `linear-gradient(140deg,${ACCENT},${ACCENT2})`, color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionLoading ? 0.5 : 1, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: `0 6px 16px -6px ${ACCENT}88` }}>
                        <Icon d={ICONS.label} size={14} c="#fff" /> Generar etiqueta
                      </motion.button>
                    )}
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>

          {/* Importes */}
          {(data.totalAmount != null || refundAmt != null) && (
            <motion.div variants={sideV}>
              <GlassCard>
                <SectionHead icon="💰" title="Importes" />
                <div style={{ padding: '12px 20px' }}>
                  {data.totalAmount != null && data.totalAmount > 0 && <Row label="Coste etiqueta" value={`${data.totalAmount.toFixed(2)}€`} />}
                  {refundAmt != null && refundAmt > 0 && (
                    <Row label="Reembolso" value={
                      <span style={{ color: data.refundedAt ? '#3fb98a' : t.faint, fontWeight: 700 }}>
                        {refundAmt.toFixed(2)}€{data.refundedAt ? ' ✓' : ' (pendiente)'}
                      </span>
                    } />
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}

        </motion.div>
      </motion.div>
    </div>
  );
}
