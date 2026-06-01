'use client';

import { useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  REQUESTED:     { label: 'En espera',       color: '#92400e', bg: '#fef3c7', dot: '#f59e0b' },
  LABEL_CREATED: { label: 'Etiqueta enviada',color: '#1e40af', bg: '#dbeafe', dot: '#3b82f6' },
  RECEIVED:      { label: 'Por revisar',     color: '#5b21b6', bg: '#ede9fe', dot: '#7c3aed' },
  APPROVED:      { label: 'Aprobada',        color: '#065f46', bg: '#d1fae5', dot: '#10b981' },
  REJECTED:      { label: 'Rechazada',       color: '#991b1b', bg: '#fee2e2', dot: '#ef4444' },
  CANCELLED:     { label: 'Cancelada',       color: '#475569', bg: '#f1f5f9', dot: '#94a3b8' },
};

const EXCEPTION_LABELS: Record<string, { label: string; color: string }> = {
  EXTEND_WINDOW:  { label: 'Ampliar plazo',        color: '#1d4ed8' },
  FREE_LABEL:     { label: 'Etiqueta gratis',       color: '#047857' },
  ACCEPT_EXPIRED: { label: 'Aceptar expirado',      color: '#b45309' },
  BLOCK:          { label: 'Bloqueado',             color: '#b91c1c' },
};

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

interface Toast { id: number; msg: string; type: 'ok' | 'err' }
type Tab = 'list' | 'config' | 'exceptions';

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
  if (m < 60) return `Hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Hace ${d}d`;
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: '#475569', bg: '#f1f5f9', dot: '#94a3b8' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
      color: m.color, background: m.bg, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
      {m.label}
    </span>
  );
}

export default function AdminDevolucionesPage() {
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

  const [exceptions, setExceptions]   = useState<ReturnException[]>([]);
  const [showNewEx, setShowNewEx]     = useState(false);
  const [newEx, setNewEx] = useState({ orderNumber: '', customerEmail: '', type: 'EXTEND_WINDOW', extraDays: 7, notes: '', expiresAt: '' });

  useEffect(() => {
    const stored = localStorage.getItem('token') || localStorage.getItem('mitaller_token');
    if (stored) { setToken(stored); loadAll(stored); }
    else { window.location.href = '/login'; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (token) loadAll(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
    devs:      returns.filter(r => r.type === 'RETURN').length,
    cambios:   returns.filter(r => r.type === 'EXCHANGE').length,
  };

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

  // Login screen
  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '36px 32px', width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Panel de devoluciones</div>
          <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>Speedwear Admin</div>
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          if (!tokenInput.trim()) return;
          localStorage.setItem('token', tokenInput.trim());
          localStorage.setItem('mitaller_token', tokenInput.trim());
          setToken(tokenInput.trim());
          loadAll(tokenInput.trim());
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 16 }}>
            Token JWT
            <input type="password" style={inp} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="eyJ..." required />
          </label>
          <button type="submit" style={btnPrimary}>Entrar →</button>
        </form>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7', fontFamily: "-apple-system, 'SF Pro Display', BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
        .row-hover:hover { background: #f9fafb !important; }
        .kpi-chip:hover { border-color: #6b7280 !important; }
        .filter-btn:hover { background: #f3f4f6 !important; }
      `}</style>

      {/* Toast */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '12px 18px', borderRadius: 10, fontSize: 14, fontWeight: 500,
            background: t.type === 'ok' ? '#111827' : '#991b1b', color: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)', animation: 'fadeIn 0.2s ease',
          }}>{t.msg}</div>
        ))}
      </div>

      {/* Top nav */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', height: 56, display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://d3k81ch9hvuctc.cloudfront.net/company/Yiztrx/images/2542dbd7-26d2-4c03-89ff-ac50f08da007.png" alt="Logo" style={{ height: 28, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
          <div style={{ display: 'flex', gap: 0 }}>
            {([['list', 'Devoluciones'], ['config', 'Configuración'], ['exceptions', 'Excepciones']] as [Tab, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: '6px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === id ? 600 : 400,
                color: tab === id ? '#111827' : '#6b7280',
                borderBottom: `2px solid ${tab === id ? '#111827' : 'transparent'}`,
                marginBottom: -1, transition: 'all 0.15s',
              }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="/devoluciones" target="_blank" style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none', padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }}>
            Portal ↗
          </a>
          <button onClick={logout} style={{ fontSize: 12, color: '#6b7280', background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
            Salir
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px' }}>

        {/* ── TAB: LIST ── */}
        {tab === 'list' && (
          <>
            {/* KPI chips */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                { label: 'EN ESPERA', value: kpis.espera, color: '#92400e', dot: '#f59e0b' },
                { label: 'POR REVISAR', value: kpis.revisar, color: '#5b21b6', dot: '#7c3aed' },
                { label: 'PENDIENTE APROBACIÓN', value: kpis.aprobadas, color: '#065f46', dot: '#10b981' },
                { label: 'ÚLTIMOS 30D', value: kpis.trans30, color: '#374151', dot: '#9ca3af' },
                { label: 'DEVOLUCIONES', value: kpis.devs, color: '#374151', dot: '#3b82f6' },
                { label: 'CAMBIOS', value: kpis.cambios, color: '#374151', dot: '#8b5cf6' },
              ].map(chip => (
                <div key={chip.label} className="kpi-chip" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                  padding: '8px 14px', cursor: 'default', transition: 'border-color 0.15s',
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: chip.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{chip.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: chip.color, lineHeight: 1 }}>{chip.value}</span>
                </div>
              ))}
            </div>

            {/* Section header */}
            <div style={{ background: '#1e293b', borderRadius: '10px 10px 0 0', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Todas las transacciones</span>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>({filtered.length})</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'date' | 'status')}
                  style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 8px', cursor: 'pointer' }}
                >
                  <option value="date">Recientes primero</option>
                  <option value="status">Por estado</option>
                </select>
                <button onClick={() => loadAll(token)} style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
                  ↻ Actualizar
                </button>
              </div>
            </div>

            {/* Search + filters bar */}
            <div style={{ background: '#fff', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1', minWidth: 200, maxWidth: 320 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>🔍</span>
                <input
                  type="search"
                  placeholder="Pedido, cliente o email..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ ...inp, paddingLeft: 32, fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {([['ALL', 'Todas'], ...Object.entries(STATUS_META).map(([k, v]) => [k, v.label])] as [string, string][]).map(([key, label]) => (
                  <button key={key} className="filter-btn" onClick={() => setFilter(key)} style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: filterStatus === key ? 600 : 400,
                    borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
                    background: filterStatus === key ? '#111827' : '#f9fafb',
                    color: filterStatus === key ? '#fff' : '#6b7280',
                    border: `1px solid ${filterStatus === key ? '#111827' : '#e5e7eb'}`,
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Table */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>
              {/* Header row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 180px 120px 150px 90px',
                padding: '9px 18px',
                background: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
                fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                <span>Pedido</span>
                <span>Cliente</span>
                <span>Actualizado</span>
                <span>Tipo</span>
                <span>Estado</span>
                <span style={{ textAlign: 'right' }}>Importe</span>
              </div>

              {loading && (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: 60, fontSize: 14 }}>Cargando…</div>
              )}

              {!loading && filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                  <div style={{ color: '#9ca3af', fontSize: 15 }}>
                    {returns.length === 0 ? 'No hay devoluciones todavía' : 'Sin resultados para este filtro'}
                  </div>
                </div>
              )}

              {!loading && filtered.map((ret, i) => {
                const amount = ret.type === 'EXCHANGE'
                  ? (ret.totalAmount ?? 0)
                  : (ret.shopifyRefundAmount ?? ret.refundAmount ?? ret.totalAmount ?? 0);
                const amountLabel = ret.type === 'EXCHANGE'
                  ? (amount > 0 ? `+${amount.toFixed(2)}€` : null)
                  : (amount > 0 ? `-${amount.toFixed(2)}€` : null);
                const amountColor = ret.type === 'EXCHANGE' ? '#f59e0b' : '#10b981';

                return (
                  <div
                    key={ret.id}
                    className="row-hover"
                    onClick={() => window.location.href = `/admin/devoluciones/${ret.id}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '140px 1fr 180px 120px 150px 90px',
                      padding: '13px 18px',
                      borderTop: i === 0 ? 'none' : '1px solid #f3f4f6',
                      cursor: 'pointer',
                      alignItems: 'center',
                      background: '#fff',
                      transition: 'background 0.1s',
                    }}
                  >
                    {/* Order */}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{ret.shopifyOrderNumber}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{ret.items.length} artículo{ret.items.length !== 1 ? 's' : ''}</div>
                    </div>

                    {/* Customer */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{ret.customerName}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>{ret.customerEmail}</div>
                    </div>

                    {/* Date */}
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {timeAgo(ret.updatedAt ?? ret.createdAt)}
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
                        {new Date(ret.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </div>

                    {/* Type badge */}
                    <div>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, display: 'inline-block',
                        background: ret.type === 'EXCHANGE' ? '#ede9fe' : '#dbeafe',
                        color: ret.type === 'EXCHANGE' ? '#5b21b6' : '#1e40af',
                      }}>
                        {ret.type === 'EXCHANGE' ? '⇄ Cambio' : '↩ Dev.'}
                      </span>
                      {ret.paymentStatus === 'PENDING' && ret.totalAmount && ret.totalAmount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, display: 'inline-block', marginTop: 3, background: '#fef3c7', color: '#92400e' }}>
                          💳 Pdte. pago
                        </span>
                      )}
                    </div>

                    {/* Status */}
                    <StatusPill status={ret.status} />

                    {/* Amount */}
                    <div style={{ textAlign: 'right' }}>
                      {amountLabel && (
                        <span style={{ fontSize: 13, fontWeight: 700, color: amountColor }}>{amountLabel}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── TAB: CONFIG ── */}
        {tab === 'config' && configDraft && !loading && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 28, maxWidth: 700 }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#111827' }}>Configuración del sistema</h2>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 20, cursor: 'pointer' }}>
              <input type="checkbox" checked={configDraft.enabled}
                onChange={e => setDraft({ ...configDraft, enabled: e.target.checked })}
                style={{ width: 18, height: 18, accentColor: '#111827' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>Sistema de devoluciones activo</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Desactiva para pausar el portal completamente</div>
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: configDraft.enabled ? '#d1fae5' : '#fee2e2', color: configDraft.enabled ? '#065f46' : '#991b1b' }}>
                {configDraft.enabled ? 'Activo' : 'Pausado'}
              </span>
            </label>

            <div style={{ height: 1, background: '#f3f4f6', margin: '0 0 20px' }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <label style={cfgLabel}>
                <span>Plazo de devolución (días)</span>
                <input type="number" min={1} max={365} style={inp} value={configDraft.windowDays}
                  onChange={e => setDraft({ ...configDraft, windowDays: Number(e.target.value) })} />
              </label>
              <label style={cfgLabel}>
                <span>Precio etiqueta (€)</span>
                <input type="number" step="0.01" min={0} style={inp} value={configDraft.labelPrice}
                  onChange={e => setDraft({ ...configDraft, labelPrice: Number(e.target.value) })} />
              </label>
              <label style={cfgLabel}>
                <span>Política de cambios</span>
                <select style={inp} value={configDraft.exchangePolicy}
                  onChange={e => setDraft({ ...configDraft, exchangePolicy: e.target.value as 'ANY' | 'SAME_TYPE' | 'VARIANT_ONLY' })}>
                  <option value="ANY">Cualquier producto</option>
                  <option value="SAME_TYPE">Mismo tipo</option>
                  <option value="VARIANT_ONLY">Solo otra variante</option>
                </select>
              </label>
              <label style={cfgLabel}>
                <span>Código SendCloud retorno</span>
                <input type="text" style={inp} value={configDraft.shippingProductCode ?? ''} placeholder="correos:paqretorno"
                  onChange={e => setDraft({ ...configDraft, shippingProductCode: e.target.value || null })} />
              </label>
            </div>

            <label style={{ ...cfgLabel, marginBottom: 24 }}>
              <span>Texto términos legales (opcional)</span>
              <textarea style={{ ...inp, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }}
                value={configDraft.termsText ?? ''}
                onChange={e => setDraft({ ...configDraft, termsText: e.target.value || null })}
                placeholder="Se mostrará al cliente en el portal..." />
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDraft(config)} style={btnSecondary}>Descartar</button>
              <button onClick={saveConfig} disabled={savingConfig || JSON.stringify(config) === JSON.stringify(configDraft)}
                style={{ ...btnPrimary, flex: 1, marginTop: 0, opacity: (savingConfig || JSON.stringify(config) === JSON.stringify(configDraft)) ? 0.5 : 1 }}>
                {savingConfig ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}

        {/* ── TAB: EXCEPTIONS ── */}
        {tab === 'exceptions' && !loading && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 14, color: '#6b7280' }}>{exceptions.length} excepcion{exceptions.length !== 1 ? 'es' : ''}</div>
              <button onClick={() => setShowNewEx(true)} style={{ ...btnPrimary, marginTop: 0, width: 'auto', padding: '9px 18px' }}>
                + Nueva excepción
              </button>
            </div>

            {exceptions.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', padding: 80, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
                Sin excepciones. Crea una para extender plazos, regalar etiquetas o bloquear devoluciones.
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', fontSize: 11, textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '0.06em' }}>
                      {['Match', 'Tipo', 'Detalle', 'Expira', 'Estado', ''].map((h, i) => (
                        <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.map((ex, i) => {
                      const meta = EXCEPTION_LABELS[ex.type];
                      return (
                        <tr key={ex.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #f3f4f6', fontSize: 14 }}>
                          <td style={{ padding: '12px 16px' }}>
                            {ex.orderNumber && <div style={{ fontWeight: 600, color: '#111827' }}>{ex.orderNumber}</div>}
                            {ex.customerEmail && <div style={{ fontSize: 12, color: '#6b7280' }}>{ex.customerEmail}</div>}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            {ex.type === 'EXTEND_WINDOW' && <span>+{ex.extraDays} días</span>}
                            {ex.notes && <div style={{ fontSize: 12, color: '#6b7280' }}>{ex.notes}</div>}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: '#9ca3af' }}>
                            {ex.expiresAt ? new Date(ex.expiresAt).toLocaleDateString('es-ES') : '—'}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                              <input type="checkbox" checked={ex.active}
                                onChange={e => toggleException(ex.id, e.target.checked)}
                                style={{ accentColor: '#111827' }} />
                              <span style={{ fontSize: 12, color: ex.active ? '#065f46' : '#9ca3af' }}>
                                {ex.active ? 'Activa' : 'Inactiva'}
                              </span>
                            </label>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <button onClick={() => deleteException(ex.id)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: 8, cursor: 'pointer' }}>
                              Borrar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {showNewEx && (
              <div onClick={() => setShowNewEx(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100 }}>
                <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, padding: 28, boxShadow: '0 8px 40px rgba(0,0,0,0.16)' }}>
                  <h3 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700, color: '#111827' }}>Nueva excepción</h3>
                  {[
                    { label: 'Tipo', content: (<select style={inp} value={newEx.type} onChange={e => setNewEx({ ...newEx, type: e.target.value })}><option value="EXTEND_WINDOW">Ampliar plazo</option><option value="FREE_LABEL">Etiqueta gratis</option><option value="ACCEPT_EXPIRED">Aceptar fuera de plazo</option><option value="BLOCK">Bloquear devolución</option></select>) },
                    { label: 'Número de pedido (opcional)', content: (<input type="text" style={inp} placeholder="#12345" value={newEx.orderNumber} onChange={e => setNewEx({ ...newEx, orderNumber: e.target.value })} />) },
                    { label: 'Email cliente (opcional)', content: (<input type="email" style={inp} placeholder="cliente@email.com" value={newEx.customerEmail} onChange={e => setNewEx({ ...newEx, customerEmail: e.target.value })} />) },
                    ...(newEx.type === 'EXTEND_WINDOW' ? [{ label: 'Días extra', content: (<input type="number" min={1} max={365} style={inp} value={newEx.extraDays} onChange={e => setNewEx({ ...newEx, extraDays: Number(e.target.value) })} />) }] : []),
                    { label: 'Notas internas', content: (<input type="text" style={inp} placeholder="Ej: cliente VIP, error nuestro..." value={newEx.notes} onChange={e => setNewEx({ ...newEx, notes: e.target.value })} />) },
                    { label: 'Expira (opcional)', content: (<input type="date" style={inp} value={newEx.expiresAt} onChange={e => setNewEx({ ...newEx, expiresAt: e.target.value })} />) },
                  ].map((row, i) => (
                    <label key={i} style={{ ...cfgLabel, marginBottom: 14 }}>
                      <span>{row.label}</span>
                      {row.content}
                    </label>
                  ))}
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button onClick={() => setShowNewEx(false)} style={btnSecondary}>Cancelar</button>
                    <button onClick={createException} style={{ ...btnPrimary, flex: 1, marginTop: 0 }}>Crear excepción</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {loading && tab !== 'list' && (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: 60 }}>Cargando…</div>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
  fontSize: 14, color: '#111827', background: '#fff', outline: 'none', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  marginTop: 16, width: '100%', padding: '10px 20px',
  background: '#111827', color: '#fff', border: 'none',
  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '9px 16px', background: '#fff', color: '#374151',
  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
};
const cfgLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 13, fontWeight: 500, color: '#374151',
};
