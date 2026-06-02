'use client';

import { use, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const ACCENT = '#34B27B';
const ACCENT2 = '#2A9D8F';
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif";

const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  REQUESTED:     { label: 'En espera',        color: '#92400e', bg: '#fef3c7', dot: '#f59e0b' },
  LABEL_CREATED: { label: 'Etiqueta enviada', color: '#1e40af', bg: '#dbeafe', dot: '#3b82f6' },
  RECEIVED:      { label: 'Por revisar',      color: '#5b21b6', bg: '#ede9fe', dot: '#7c3aed' },
  APPROVED:      { label: 'Aprobada',         color: '#065f46', bg: '#d1fae5', dot: '#10b981' },
  REJECTED:      { label: 'Rechazada',        color: '#991b1b', bg: '#fee2e2', dot: '#ef4444' },
  CANCELLED:     { label: 'Cancelada',        color: '#475569', bg: '#f1f5f9', dot: '#94a3b8' },
};

const REASON_LABELS: Record<string, string> = {
  WRONG_SIZE: 'Talla incorrecta',
  DEFECTIVE: 'Defectuoso',
  NOT_AS_DESCRIBED: 'No coincide con descripción',
  CHANGED_MIND: 'Cambio de opinión',
  WRONG_ITEM: 'Artículo incorrecto',
  OTHER: 'Otro motivo',
};

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

interface Toast { id: number; msg: string; type: 'ok' | 'err' }

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

// Variants
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.32, ease: EASE },
  }),
};

const sidebarCardVariants = {
  initial: { opacity: 0, x: 20 },
  animate: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.07 + 0.1, duration: 0.32, ease: EASE },
  }),
};

const timelineItemVariants = {
  initial: { opacity: 0, x: -12 },
  animate: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.1 + 0.3, duration: 0.28, ease: EASE },
  }),
};

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: '#475569', bg: '#f1f5f9', dot: '#94a3b8' };
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', damping: 18, stiffness: 300 }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20, color: m.color, background: m.bg }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot }} />
      {m.label}
    </motion.span>
  );
}

function Card({ children, style, index = 0, sidebar = false }: { children: React.ReactNode; style?: React.CSSProperties; index?: number; sidebar?: boolean }) {
  return (
    <motion.div
      custom={index}
      variants={sidebar ? sidebarCardVariants : cardVariants}
      initial="initial"
      animate="animate"
      whileHover={{ boxShadow: '0 8px 28px -8px rgba(0,0,0,0.12)', borderColor: `${ACCENT}33` }}
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', transition: 'border-color .2s', ...style }}
    >
      {children}
    </motion.div>
  );
}

function CardHeader({ title, icon }: { title: string; icon?: string }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
      <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid #f9fafb' }}>
      <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500, flexShrink: 0, marginRight: 16 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#111827', fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function PhotoSection({ returnId, token }: { returnId: string; token: string }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/returns/${returnId}/photos`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setPhotos(d.map((p: { data: string }) => p.data)))
      .catch(() => {});
  }, [returnId, token]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const data = reader.result as string;
      await fetch(`${API_URL}/returns/${returnId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data }),
      });
      setPhotos(p => [...p, data]);
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: photos.length > 0 ? 10 : 0 }}>
        <AnimatePresence>
          {photos.map((src, i) => (
            <motion.img
              key={i}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', damping: 18, stiffness: 280 }}
              src={src}
              alt={`foto ${i + 1}`}
              onClick={() => window.open(src, '_blank')}
              whileHover={{ scale: 1.06 }}
              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer' }}
            />
          ))}
        </AnimatePresence>
        {photos.length === 0 && <span style={{ fontSize: 13, color: '#9ca3af' }}>Sin fotos adjuntas</span>}
      </div>
      <motion.label
        whileHover={{ scale: 1.02, borderColor: `${ACCENT}66` }}
        whileTap={{ scale: 0.97 }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500, color: '#374151', marginTop: 8 }}
      >
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
        {uploading ? '⏳ Subiendo...' : '📷 Añadir foto'}
      </motion.label>
    </div>
  );
}

export default function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [token, setToken] = useState('');
  const [data, setData] = useState<ReturnRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState('');
  const { toasts, ok, err } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('token') || localStorage.getItem('mitaller_token');
    if (!stored) { window.location.href = '/login'; return; }
    setToken(stored);
    loadReturn(stored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function auth(t: string) { return { Authorization: `Bearer ${t}` }; }

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
        const res = await fetch(`${API_URL}/returns/${data.id}/generate-label`,
          { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) } });
        const d = await res.json();
        if (!res.ok) throw new Error(d.message ?? 'Error generando etiqueta');
        ok('Etiqueta generada y enviada ✓');
      } else if (status === 'RECEIVED') {
        const res = await fetch(`${API_URL}/returns/${data.id}/received`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) } });
        if (!res.ok) throw new Error((await res.json()).message ?? 'Error');
        ok('Marcada como recibida ✓');
      } else {
        const res = await fetch(`${API_URL}/returns/${data.id}/status`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ status }) });
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
      const res = await fetch(`${API_URL}/returns/${data.id}/verify`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ verificationStatus, verificationNotes: verifyNotes || undefined }) });
      if (!res.ok) throw new Error('Error verificando');
      ok(verificationStatus === 'OK' ? 'Verificación correcta ✓' : 'Incidencia registrada');
      loadReturn(token);
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
    finally { setActionLoading(false); }
  }

  function parseAddress(value: unknown): string {
    if (!value) return '—';
    let address = value;
    if (typeof value === 'string') {
      try { address = JSON.parse(value); } catch { return value; }
    }
    if (!address || typeof address !== 'object') return String(address);
    const a = address as Record<string, unknown>;
    return [a.address1, a.address2, a.city, a.province, a.zip, a.country ?? a.countryCodeV2]
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .map(String).filter(Boolean).join(', ') || '—';
  }

  if (!token && !loading) return null;

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f5f7', fontFamily: FONT }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        style={{ textAlign: 'center' }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.75, repeat: Infinity, ease: 'linear' }}
          style={{ width: 32, height: 32, border: `3px solid #e5e7eb`, borderTopColor: ACCENT, borderRadius: '50%', margin: '0 auto 12px' }}
        />
        <div style={{ fontSize: 14, color: '#9ca3af' }}>Cargando devolución…</div>
      </motion.div>
    </div>
  );

  if (notFound) return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f4f5f7', gap: 16, fontFamily: FONT }}
    >
      <div style={{ fontSize: 48 }}>🔍</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#111827' }}>Devolución no encontrada</div>
      <motion.button
        whileHover={{ scale: 1.03, borderColor: `${ACCENT}66` }}
        whileTap={{ scale: 0.97 }}
        onClick={() => window.location.href = '/admin/devoluciones'}
        style={{ fontSize: 14, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontFamily: FONT }}
      >
        ← Volver al listado
      </motion.button>
    </motion.div>
  );

  if (!data) return null;

  const shippingAddr = parseAddress(data.order.shippingAddressJson);
  const refundAmount = data.shopifyRefundAmount ?? data.refundAmount ?? data.totalAmount;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7', fontFamily: FONT }}>
      <style>{`
        input:focus, select:focus, textarea:focus { border-color: ${ACCENT}88 !important; box-shadow: 0 0 0 3px ${ACCENT}1f !important; outline: none; }
      `}</style>

      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 999 }}>
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1, transition: { type: 'spring', damping: 20, stiffness: 300 } }}
              exit={{ opacity: 0, x: 40, scale: 0.9, transition: { duration: 0.18 } }}
              style={{ padding: '12px 18px', borderRadius: 10, fontSize: 14, fontWeight: 500, background: t.type === 'ok' ? `linear-gradient(140deg,${ACCENT},${ACCENT2})` : '#991b1b', color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
            >{t.msg}</motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Top nav */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', height: 56, display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://d3k81ch9hvuctc.cloudfront.net/company/Yiztrx/images/2542dbd7-26d2-4c03-89ff-ac50f08da007.png" alt="Logo" style={{ height: 28, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
          <motion.button
            whileHover={{ x: -2, color: ACCENT }}
            onClick={() => window.location.href = '/admin/devoluciones'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: FONT, transition: 'color .15s' }}
          >
            ← Listado de devoluciones
          </motion.button>
          <div style={{ width: 1, height: 16, background: '#e5e7eb' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{data.shopifyOrderNumber}</span>
          <AnimatePresence mode="wait">
            <StatusPill key={data.status} status={data.status} />
          </AnimatePresence>
          <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: data.type === 'EXCHANGE' ? '#ede9fe' : '#dbeafe', color: data.type === 'EXCHANGE' ? '#5b21b6' : '#1e40af', fontWeight: 600 }}>
            {data.type === 'EXCHANGE' ? '⇄ Cambio' : '↩ Devolución'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data.status !== 'APPROVED' && data.status !== 'REJECTED' && data.status !== 'CANCELLED' && (
            <motion.button
              whileHover={{ y: -2, boxShadow: '0 8px 20px -8px rgba(16,185,129,0.6)' }}
              whileTap={{ scale: 0.96 }}
              disabled={actionLoading}
              onClick={() => updateStatus('APPROVED')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionLoading ? 0.6 : 1, fontFamily: FONT }}
            >
              ✓ Aprobar
            </motion.button>
          )}
          {data.status !== 'REJECTED' && data.status !== 'CANCELLED' && data.status !== 'APPROVED' && (
            <motion.button
              whileHover={{ y: -2, boxShadow: '0 8px 20px -8px rgba(239,68,68,0.4)' }}
              whileTap={{ scale: 0.96 }}
              disabled={actionLoading}
              onClick={() => updateStatus('REJECTED')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#fff', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionLoading ? 0.6 : 1, fontFamily: FONT }}
            >
              ✕ Rechazar
            </motion.button>
          )}
          <motion.button
            whileHover={{ rotate: 180 }}
            transition={{ duration: 0.4 }}
            onClick={() => loadReturn(token)}
            style={{ padding: '7px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, color: '#6b7280', cursor: 'pointer', fontFamily: FONT }}
          >
            ↻
          </motion.button>
        </div>
      </motion.div>

      {/* Main layout */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Products */}
          <Card index={0}>
            <CardHeader title="Artículos solicitados" icon="📦" />
            <div style={{ padding: '4px 0' }}>
              {data.items.map((item, i) => (
                <motion.div
                  key={item.id}
                  custom={i}
                  variants={timelineItemVariants}
                  initial="initial"
                  animate="animate"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px', borderBottom: i < data.items.length - 1 ? '1px solid #f3f4f6' : 'none' }}
                >
                  {item.orderItem.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <motion.img
                      whileHover={{ scale: 1.06 }}
                      src={item.orderItem.imageUrl}
                      alt=""
                      style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', flexShrink: 0, cursor: 'pointer' }}
                    />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 8, background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📷</div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                      {item.orderItem.title}
                      {item.orderItem.variantTitle && <span style={{ color: '#6b7280', fontWeight: 400 }}> — {item.orderItem.variantTitle}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>SKU: {item.orderItem.sku}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: '#f3f4f6', color: '#6b7280' }}>
                        {REASON_LABELS[item.reason] ?? item.reason}
                      </span>
                      {item.replacementTitle && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: '#ede9fe', color: '#5b21b6' }}>
                          → {item.replacementTitle} {item.replacementPrice != null ? `(${item.replacementPrice.toFixed(2)}€)` : ''}
                        </span>
                      )}
                    </div>
                    {item.notes && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>"{item.notes}"</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>×{item.quantity}</div>
                    {item.orderItem.price != null && (
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{item.orderItem.price.toFixed(2)}€</div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
            {data.notes && (
              <div style={{ padding: '12px 16px', background: '#fffbeb', borderTop: '1px solid #fde68a' }}>
                <span style={{ fontSize: 12, color: '#92400e' }}>💬 Nota del cliente: </span>
                <span style={{ fontSize: 13, color: '#78350f' }}>{data.notes}</span>
              </div>
            )}
          </Card>

          {/* Verification */}
          <Card index={1}>
            <CardHeader title="Verificación del paquete" icon="🔍" />
            <div style={{ padding: '16px' }}>
              <AnimatePresence mode="wait">
                {data.verificationStatus ? (
                  <motion.div
                    key="verified"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: data.verificationNotes ? 10 : 0 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 700, padding: '5px 14px', borderRadius: 20,
                        background: data.verificationStatus === 'OK' ? '#d1fae5' : '#fee2e2',
                        color: data.verificationStatus === 'OK' ? '#065f46' : '#991b1b',
                      }}>
                        {data.verificationStatus === 'OK' ? '✅ Todo correcto' : '⚠️ Incidencia detectada'}
                      </span>
                      {data.verifiedAt && (
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>
                          {new Date(data.verifiedAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    {data.verificationNotes && (
                      <div style={{ fontSize: 13, color: '#6b7280', padding: '10px 14px', background: '#f9fafb', borderRadius: 8, marginTop: 10 }}>
                        {data.verificationNotes}
                      </div>
                    )}
                  </motion.div>
                ) : data.status === 'RECEIVED' ? (
                  <motion.div
                    key="verify-form"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22 }}
                  >
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: '#374151' }}>Paquete recibido. ¿El contenido es correcto?</p>
                    <input
                      type="text"
                      placeholder="Notas de verificación (opcional)"
                      value={verifyNotes}
                      onChange={e => setVerifyNotes(e.target.value)}
                      style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, width: '100%', marginBottom: 10, boxSizing: 'border-box', fontFamily: FONT }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <motion.button
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => verifyReturn('OK')}
                        disabled={actionLoading}
                        style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600, background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: 8, cursor: 'pointer', opacity: actionLoading ? 0.6 : 1, fontFamily: FONT }}
                      >✅ Todo correcto</motion.button>
                      <motion.button
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => verifyReturn('ISSUE')}
                        disabled={actionLoading}
                        style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 8, cursor: 'pointer', opacity: actionLoading ? 0.6 : 1, fontFamily: FONT }}
                      >⚠️ Hay incidencia</motion.button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="pending"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ fontSize: 13, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
                  >
                    <span style={{ fontSize: 16 }}>⏳</span>
                    {data.receivedAt
                      ? `Recibido el ${new Date(data.receivedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}`
                      : 'Pendiente de recibir el paquete'}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>

          {/* Photos */}
          <Card index={2}>
            <CardHeader title="Evidencia fotográfica" icon="📸" />
            <PhotoSection returnId={data.id} token={token} />
          </Card>

          {/* Timeline */}
          <Card index={3}>
            <CardHeader title="Historial de la solicitud" icon="🕐" />
            <div style={{ padding: '12px 16px' }}>
              {[
                { date: data.createdAt, label: 'Solicitud creada', icon: '📋', active: true },
                { date: data.receivedAt, label: 'Paquete recibido en almacén', icon: '📦', active: !!data.receivedAt },
                { date: data.verifiedAt, label: data.verificationStatus === 'ISSUE' ? 'Verificación: incidencia detectada' : 'Verificación correcta', icon: data.verificationStatus === 'ISSUE' ? '⚠️' : '✅', active: !!data.verifiedAt },
                { date: data.refundedAt, label: `Reembolso procesado${refundAmount ? ` · ${refundAmount.toFixed(2)}€` : ''}`, icon: '💰', active: !!data.refundedAt },
              ].map((ev, i) => (
                <motion.div
                  key={i}
                  custom={i}
                  variants={timelineItemVariants}
                  initial="initial"
                  animate="animate"
                  style={{ display: 'flex', gap: 12, marginBottom: i < 3 ? 12 : 0, opacity: ev.active ? 1 : 0.35 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <motion.div
                      initial={{ scale: 0.6 }}
                      animate={{ scale: ev.active ? 1 : 0.85 }}
                      transition={{ delay: i * 0.1 + 0.4, type: 'spring', damping: 16, stiffness: 280 }}
                      style={{ width: 28, height: 28, borderRadius: '50%', background: ev.active ? '#f0fdf4' : '#f9fafb', border: `1px solid ${ev.active ? '#86efac' : '#e5e7eb'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}
                    >{ev.icon}</motion.div>
                    {i < 3 && <div style={{ width: 1, flex: 1, minHeight: 16, background: ev.active ? '#86efac' : '#e5e7eb', margin: '4px 0' }} />}
                  </div>
                  <div style={{ paddingTop: 4, paddingBottom: i < 3 ? 8 : 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: ev.active ? '#111827' : '#9ca3af' }}>{ev.label}</div>
                    {ev.date && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        {new Date(ev.date).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </Card>

        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Status */}
          <Card index={0} sidebar>
            <CardHeader title="Estado" icon="🏷️" />
            <div style={{ padding: '14px 16px' }}>
              <div style={{ marginBottom: 12 }}>
                <AnimatePresence mode="wait">
                  <StatusPill key={data.status} status={data.status} />
                </AnimatePresence>
              </div>

              {data.status === 'APPROVED' && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  style={{ padding: '10px 12px', borderRadius: 8, background: data.refundedAt ? '#f0fdf4' : '#fffbeb', border: `1px solid ${data.refundedAt ? '#86efac' : '#fde68a'}`, marginBottom: 12 }}
                >
                  {data.refundedAt ? (
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>
                      ✓ Reembolso enviado · {refundAmount?.toFixed(2)}€
                      <div style={{ fontWeight: 400, color: '#16a34a', marginTop: 2 }}>
                        {new Date(data.refundedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>⏳ Reembolso pendiente en Shopify</div>
                  )}
                </motion.div>
              )}

              {data.paymentStatus === 'PENDING' && data.checkoutUrl && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#c2410c' }}>💳 Pago de etiqueta pendiente</div>
                  {data.totalAmount != null && data.totalAmount > 0 && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#ea580c', marginTop: 2 }}>{data.totalAmount.toFixed(2)}€</div>
                  )}
                  <a href={data.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: '#f97316', textDecoration: 'underline' }}>Ver checkout ↗</a>
                </div>
              )}

              <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Cambiar estado</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {Object.entries(STATUS_META)
                  .filter(([k]) => k !== data.status)
                  .map(([key, meta]) => (
                    <motion.button
                      key={key}
                      whileHover={{ x: 3, filter: 'brightness(0.95)' }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => updateStatus(key)}
                      disabled={actionLoading}
                      style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: meta.color, background: meta.bg, border: `1px solid ${meta.dot}44`, borderRadius: 8, textAlign: 'left', opacity: actionLoading ? 0.5 : 1, fontFamily: FONT }}
                    >
                      {meta.label}
                    </motion.button>
                  ))}
              </div>
            </div>
          </Card>

          {/* Customer */}
          <Card index={1} sidebar>
            <CardHeader title="Cliente" icon="👤" />
            <div style={{ padding: '12px 16px' }}>
              <InfoRow label="Nombre" value={data.customerName} />
              <InfoRow label="Email" value={<a href={`mailto:${data.customerEmail}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>{data.customerEmail}</a>} />
              {data.order.customerPhone && <InfoRow label="Teléfono" value={data.order.customerPhone} />}
              {shippingAddr !== '—' && <InfoRow label="Dirección" value={shippingAddr} />}
            </div>
          </Card>

          {/* Original order */}
          <Card index={2} sidebar>
            <CardHeader title="Pedido original" icon="🛒" />
            <div style={{ padding: '12px 16px' }}>
              <InfoRow label="Nº pedido" value={<span style={{ fontWeight: 700 }}>{data.shopifyOrderNumber}</span>} />
              {data.order.totalPrice != null && <InfoRow label="Total pedido" value={`${data.order.totalPrice.toFixed(2)}€`} />}
              {data.order.createdAt && <InfoRow label="Fecha compra" value={new Date(data.order.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })} />}
              <InfoRow label="Solicitud" value={new Date(data.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />
            </div>
          </Card>

          {/* Shipping + tracking */}
          <Card index={3} sidebar>
            <CardHeader title="Envío y seguimiento" icon="🚚" />
            <div style={{ padding: '12px 16px' }}>
              {data.trackingNumber ? (
                <>
                  <InfoRow label="Nº seguimiento" value={<span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{data.trackingNumber}</span>} />
                  {data.carrier && <InfoRow label="Transportista" value={data.carrier} />}
                  {data.labelUrl && (
                    <motion.a
                      whileHover={{ y: -2, boxShadow: '0 8px 20px -8px rgba(30,41,59,0.5)' }}
                      href={data.labelUrl.startsWith('http') ? data.labelUrl : `${API_URL}${data.labelUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, padding: '9px', background: '#1e293b', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
                    >
                      ⬇ Descargar etiqueta PDF
                    </motion.a>
                  )}
                  <motion.a
                    whileHover={{ y: -1, borderColor: `${ACCENT}66` }}
                    href={`/devoluciones/estado/${data.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, padding: '8px', background: '#f9fafb', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 8, fontSize: 12, fontWeight: 500, textDecoration: 'none' }}
                  >
                    📍 Ver estado (vista cliente) ↗
                  </motion.a>
                </>
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
                    {data.status === 'REQUESTED' ? 'Etiqueta pendiente de generar' : 'Sin tracking aún'}
                  </div>
                  {data.status === 'REQUESTED' && (
                    <motion.button
                      whileHover={{ y: -2, boxShadow: '0 8px 20px -8px rgba(30,41,59,0.5)' }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => updateStatus('LABEL_CREATED')}
                      disabled={actionLoading}
                      style={{ width: '100%', padding: '9px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionLoading ? 0.6 : 1, fontFamily: FONT }}
                    >
                      🏷️ Generar etiqueta
                    </motion.button>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Amounts */}
          {(data.totalAmount != null || refundAmount != null) && (
            <Card index={4} sidebar>
              <CardHeader title="Importes" icon="💰" />
              <div style={{ padding: '12px 16px' }}>
                {data.totalAmount != null && data.totalAmount > 0 && (
                  <InfoRow label="Coste etiqueta" value={`${data.totalAmount.toFixed(2)}€`} />
                )}
                {refundAmount != null && refundAmount > 0 && (
                  <InfoRow
                    label="Reembolso"
                    value={<span style={{ color: data.refundedAt ? '#15803d' : '#6b7280', fontWeight: 700 }}>{refundAmount.toFixed(2)}€{data.refundedAt ? ' ✓' : ' (pendiente)'}</span>}
                  />
                )}
              </div>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}
