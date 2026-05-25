'use client';

import { useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  REQUESTED:     { label: 'Solicitada',      color: '#92400e', bg: '#fef3c7', dot: '#f59e0b' },
  LABEL_CREATED: { label: 'Etiqueta creada', color: '#1e40af', bg: '#dbeafe', dot: '#3b82f6' },
  RECEIVED:      { label: 'Recibida',        color: '#5b21b6', bg: '#ede9fe', dot: '#7c3aed' },
  APPROVED:      { label: 'Aprobada',        color: '#065f46', bg: '#d1fae5', dot: '#10b981' },
  REJECTED:      { label: 'Rechazada',       color: '#991b1b', bg: '#fee2e2', dot: '#ef4444' },
  CANCELLED:     { label: 'Cancelada',       color: '#475569', bg: '#f1f5f9', dot: '#94a3b8' },
};

const REASON_LABELS: Record<string, string> = {
  WRONG_SIZE: 'Talla incorrecta',
  DEFECTIVE: 'Defectuoso',
  NOT_AS_DESCRIBED: 'No coincide',
  CHANGED_MIND: 'Cambio de opinión',
  WRONG_ITEM: 'Artículo incorrecto',
  OTHER: 'Otro',
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
  receivedAt?: string | null;
  verifiedAt?: string | null;
  verificationStatus?: string | null;
  verificationNotes?: string | null;
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

// ── Toast hook ────────────────────────────────────────────────────────────────
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

// ── Sub-components ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: '#475569', bg: '#f1f5f9', dot: '#94a3b8' };
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600,
      padding:'3px 10px', borderRadius:20, color:m.color, background:m.bg, whiteSpace:'nowrap' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:m.dot, flexShrink:0 }} />
      {m.label}
    </span>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'18px 20px', flex:1, minWidth:140 }}>
      <div style={{ fontSize:12, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:700, color: color ?? '#111827', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:'#9ca3af', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

function VerifyPanel({ returnId, onVerify }: { returnId: string; onVerify: (id: string, s: 'OK'|'ISSUE', n?: string) => void }) {
  const [notes, setNotes] = useState('');
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <input type="text" placeholder="Notas de verificación (opcional)" value={notes}
        onChange={e => setNotes(e.target.value)}
        style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #e5e7eb', fontSize:13, width:'100%' }} />
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={() => onVerify(returnId, 'OK', notes || undefined)}
          style={{ flex:1, padding:'8px 0', fontSize:13, fontWeight:600, background:'#d1fae5', color:'#065f46',
            border:'1px solid #a7f3d0', borderRadius:8, cursor:'pointer' }}>✅ Todo correcto</button>
        <button onClick={() => onVerify(returnId, 'ISSUE', notes || 'Incidencia detectada')}
          style={{ flex:1, padding:'8px 0', fontSize:13, fontWeight:600, background:'#fee2e2', color:'#991b1b',
            border:'1px solid #fca5a5', borderRadius:8, cursor:'pointer' }}>⚠️ Hay incidencia</button>
      </div>
    </div>
  );
}

function PhotoSection({ returnId, token }: { returnId: string; token: string }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/returns/${returnId}/photos`, { headers: { Authorization:`Bearer ${token}` } })
      .then(r => r.json()).then(d => setPhotos(d.map((p:{data:string}) => p.data))).catch(() => {});
  }, [returnId, token]);
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const data = reader.result as string;
      await fetch(`${API_URL}/returns/${returnId}/photos`, {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
        body: JSON.stringify({ data })
      });
      setPhotos(p => [...p, data]); setUploading(false);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div style={{ marginTop:16 }}>
      <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>📸 Evidencia fotográfica</div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
        {photos.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt={`foto ${i+1}`} onClick={() => window.open(src,'_blank')}
            style={{ width:72, height:72, objectFit:'cover', borderRadius:8, border:'1px solid #e5e7eb', cursor:'pointer' }} />
        ))}
      </div>
      <label style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px',
        background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500 }}>
        <input type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={handleFile} disabled={uploading} />
        {uploading ? '⏳ Subiendo...' : '📷 Añadir foto'}
      </label>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminDevolucionesPage() {
  const [tab, setTab] = useState<Tab>('list');
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(true);
  const { toasts, ok, err } = useToast();

  const [returns, setReturns]       = useState<ReturnRecord[]>([]);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [filterStatus, setFilter]   = useState('ALL');
  const [search, setSearch]         = useState('');

  const [config, setConfig]         = useState<ReturnConfig | null>(null);
  const [configDraft, setDraft]     = useState<ReturnConfig | null>(null);
  const [savingConfig, setSaving]   = useState(false);

  const [exceptions, setExceptions]         = useState<ReturnException[]>([]);
  const [showNewEx, setShowNewEx]           = useState(false);
  const [newEx, setNewEx] = useState({ orderNumber:'', customerEmail:'', type:'EXTEND_WINDOW', extraDays:7, notes:'', expiresAt:'' });

  useEffect(() => {
    const stored = localStorage.getItem('token') || localStorage.getItem('mitaller_token');
    if (stored) { setToken(stored); loadAll(stored); }
    else { window.location.href = '/login'; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (token) loadAll(token); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  function auth(t: string) { return { Authorization: `Bearer ${t}` }; }
  function logout() {
    ['token','mitaller_token'].forEach(k => localStorage.removeItem(k));
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

  async function updateStatus(returnId: string, status: string) {
    try {
      if (status === 'LABEL_CREATED') {
        const res = await fetch(`${API_URL}/returns/${returnId}/generate-label`,
          { method:'POST', headers:{'Content-Type':'application/json', ...auth(token)} });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? 'Error generando etiqueta');
        ok('Etiqueta generada y enviada ✓');
      } else if (status === 'RECEIVED') {
        const res = await fetch(`${API_URL}/returns/${returnId}/received`,
          { method:'PATCH', headers:{'Content-Type':'application/json', ...auth(token)} });
        if (!res.ok) throw new Error((await res.json()).message ?? 'Error');
        ok('Marcada como recibida ✓');
      } else {
        const res = await fetch(`${API_URL}/returns/${returnId}/status`,
          { method:'PATCH', headers:{'Content-Type':'application/json', ...auth(token)},
            body: JSON.stringify({ status }) });
        if (!res.ok) throw new Error((await res.json()).message ?? 'Error');
        ok(`Estado cambiado a ${STATUS_META[status]?.label ?? status} ✓`);
      }
      loadAll(token);
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
  }

  async function verifyReturn(returnId: string, verificationStatus: 'OK'|'ISSUE', verificationNotes?: string) {
    try {
      const res = await fetch(`${API_URL}/returns/${returnId}/verify`,
        { method:'PATCH', headers:{'Content-Type':'application/json', ...auth(token)},
          body: JSON.stringify({ verificationStatus, verificationNotes }) });
      if (!res.ok) throw new Error('Error verificando');
      ok(verificationStatus === 'OK' ? 'Verificación correcta ✓' : 'Incidencia registrada');
      loadAll(token);
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
  }

  async function saveConfig() {
    if (!configDraft) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/returns/admin/config`,
        { method:'PUT', headers:{'Content-Type':'application/json', ...auth(token)},
          body: JSON.stringify(configDraft) });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json(); setConfig(updated); setDraft(updated);
      ok('Configuración guardada ✓');
    } catch (e) { err(e instanceof Error ? e.message : 'Error guardando'); }
    finally { setSaving(false); }
  }

  async function createException() {
    if (!newEx.orderNumber && !newEx.customerEmail) { err('Indica número de pedido o email'); return; }
    try {
      const body: Record<string, unknown> = { type: newEx.type, notes: newEx.notes||undefined, expiresAt: newEx.expiresAt||undefined };
      if (newEx.orderNumber) body.orderNumber = newEx.orderNumber;
      if (newEx.customerEmail) body.customerEmail = newEx.customerEmail;
      if (newEx.type === 'EXTEND_WINDOW') body.extraDays = newEx.extraDays;
      const res = await fetch(`${API_URL}/returns/admin/exceptions`,
        { method:'POST', headers:{'Content-Type':'application/json', ...auth(token)}, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).message ?? `Error ${res.status}`);
      ok('Excepción creada ✓');
      setShowNewEx(false);
      setNewEx({ orderNumber:'', customerEmail:'', type:'EXTEND_WINDOW', extraDays:7, notes:'', expiresAt:'' });
      loadAll(token);
    } catch (e) { err(e instanceof Error ? e.message : 'Error'); }
  }

  async function toggleException(id: string, active: boolean) {
    await fetch(`${API_URL}/returns/admin/exceptions/${id}`,
      { method:'PATCH', headers:{'Content-Type':'application/json', ...auth(token)}, body: JSON.stringify({ active }) });
    loadAll(token);
  }

  async function deleteException(id: string) {
    if (!confirm('¿Borrar esta excepción?')) return;
    await fetch(`${API_URL}/returns/admin/exceptions/${id}`, { method:'DELETE', headers: auth(token) });
    ok('Excepción eliminada');
    loadAll(token);
  }

  // ── KPIs ──
  const kpis = {
    total:    returns.length,
    pending:  returns.filter(r => ['REQUESTED','LABEL_CREATED'].includes(r.status)).length,
    received: returns.filter(r => r.status === 'RECEIVED').length,
    approved: returns.filter(r => r.status === 'APPROVED').length,
    refunded: returns.filter(r => r.refundedAt).reduce((s, r) => s + (r.shopifyRefundAmount ?? r.refundAmount ?? 0), 0),
  };

  // ── Filtered list ──
  const filtered = returns.filter(r => {
    const matchStatus = filterStatus === 'ALL' || r.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q || r.shopifyOrderNumber.toLowerCase().includes(q)
      || r.customerName.toLowerCase().includes(q) || r.customerEmail.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  // ── Login ──
  if (!token) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f9fafb' }}>
      <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:'36px 32px', width:'100%', maxWidth:380, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:22, fontWeight:700, color:'#111827' }}>Panel de devoluciones</div>
          <div style={{ fontSize:14, color:'#6b7280', marginTop:4 }}>Speedwear Admin</div>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (!tokenInput.trim()) return; localStorage.setItem('token', tokenInput.trim()); localStorage.setItem('mitaller_token', tokenInput.trim()); setToken(tokenInput.trim()); loadAll(tokenInput.trim()); }}>
          <label style={{ display:'flex', flexDirection:'column', gap:6, fontSize:14, fontWeight:500, color:'#374151', marginBottom:16 }}>
            Token JWT
            <input type="password" style={inp} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="eyJ..." required />
          </label>
          <button type="submit" style={btnPrimary}>Entrar →</button>
        </form>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:'#f9fafb' }}>
      {/* ── Toast container ── */}
      <div style={{ position:'fixed', bottom:24, right:24, display:'flex', flexDirection:'column', gap:8, zIndex:999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding:'12px 18px', borderRadius:10, fontSize:14, fontWeight:500,
            background: t.type === 'ok' ? '#111827' : '#991b1b', color:'#fff',
            boxShadow:'0 4px 16px rgba(0,0,0,0.18)', animation:'fadeIn 0.2s ease'
          }}>{t.msg}</div>
        ))}
      </div>

      {/* ── Top bar ── */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e5e7eb', padding:'0 32px', display:'flex', alignItems:'center', justifyContent:'space-between', height:60 }}>
        <div style={{ display:'flex', alignItems:'center', gap:24 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#111827' }}>Devoluciones</span>
          <div style={{ display:'flex', gap:2 }}>
            {([['list','Lista'],['config','Configuración'],['exceptions','Excepciones']] as [Tab,string][]).map(([id,label]) => (
              <button key={id} onClick={() => setTab(id)}
                style={{ padding:'8px 16px', background:'transparent', border:'none', cursor:'pointer',
                  fontSize:14, fontWeight: tab===id ? 600 : 400,
                  color: tab===id ? '#111827' : '#6b7280',
                  borderBottom: `2px solid ${tab===id ? '#111827' : 'transparent'}`,
                  marginBottom:-1 }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <a href="/devoluciones" target="_blank"
            style={{ fontSize:13, color:'#6b7280', textDecoration:'none', padding:'6px 12px',
              border:'1px solid #e5e7eb', borderRadius:8 }}>
            Ver portal ↗
          </a>
          <button onClick={logout}
            style={{ fontSize:13, color:'#6b7280', background:'transparent', border:'1px solid #e5e7eb',
              borderRadius:8, padding:'6px 12px', cursor:'pointer' }}>
            Salir
          </button>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:'28px 24px' }}>

        {/* ── TAB: LIST ── */}
        {tab === 'list' && (
          <>
            {/* KPIs */}
            <div style={{ display:'flex', gap:12, marginBottom:24, flexWrap:'wrap' }}>
              <KpiCard label="Total" value={kpis.total} />
              <KpiCard label="Pendientes" value={kpis.pending} color="#92400e" />
              <KpiCard label="Recibidas" value={kpis.received} color="#5b21b6" />
              <KpiCard label="Aprobadas" value={kpis.approved} color="#065f46" />
              <KpiCard label="Reembolsado" value={`${kpis.refunded.toFixed(2)}€`} color="#1e40af"
                sub={`${returns.filter(r=>r.refundedAt).length} procesados`} />
            </div>

            {/* Filters */}
            <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
              <input type="search" placeholder="Buscar pedido, cliente, email..." value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...inp, maxWidth:280, margin:0 }} />
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {[['ALL','Todas'], ...Object.entries(STATUS_META).map(([k,v]) => [k, v.label])].map(([key,label]) => (
                  <button key={key} onClick={() => setFilter(key)}
                    style={{ padding:'6px 14px', fontSize:12, fontWeight:600, borderRadius:20, cursor:'pointer',
                      background: filterStatus===key ? '#111827' : '#fff',
                      color: filterStatus===key ? '#fff' : '#374151',
                      border: `1px solid ${filterStatus===key ? '#111827' : '#e5e7eb'}` }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {loading && <div style={{ textAlign:'center', color:'#9ca3af', padding:60 }}>Cargando…</div>}

            {!loading && filtered.length === 0 && (
              <div style={{ textAlign:'center', color:'#9ca3af', padding:80 }}>
                {returns.length === 0 ? 'No hay devoluciones aún' : 'Sin resultados para este filtro'}
              </div>
            )}

            {!loading && filtered.length > 0 && (
              <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
                {/* Table header */}
                <div style={{ display:'grid', gridTemplateColumns:'110px 90px 1fr 110px 130px 40px',
                  gap:0, padding:'10px 20px', background:'#f9fafb', borderBottom:'1px solid #e5e7eb',
                  fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em' }}>
                  <span>Pedido</span><span>Tipo</span><span>Cliente</span><span>Fecha</span><span>Estado</span><span />
                </div>

                {filtered.map((ret, i) => (
                  <div key={ret.id} style={{ borderTop: i===0 ? 'none' : '1px solid #f3f4f6' }}>
                    {/* Row */}
                    <div onClick={() => setExpanded(expanded===ret.id ? null : ret.id)}
                      style={{ display:'grid', gridTemplateColumns:'110px 90px 1fr 110px 130px 40px',
                        gap:0, padding:'14px 20px', cursor:'pointer', alignItems:'center',
                        background: expanded===ret.id ? '#fafafa' : '#fff',
                        transition:'background 0.1s' }}>
                      <span style={{ fontSize:14, fontWeight:700, color:'#111827' }}>{ret.shopifyOrderNumber}</span>
                      <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:10, display:'inline-block',
                        background: ret.type==='EXCHANGE' ? '#ede9fe' : '#dbeafe',
                        color: ret.type==='EXCHANGE' ? '#5b21b6' : '#1e40af' }}>
                        {ret.type==='EXCHANGE' ? '🔄 Cambio' : '↩ Dev.'}
                      </span>
                      <div>
                        <div style={{ fontSize:14, fontWeight:500, color:'#111827' }}>{ret.customerName}</div>
                        <div style={{ fontSize:12, color:'#9ca3af' }}>{ret.customerEmail}</div>
                      </div>
                      <div style={{ fontSize:12, color:'#9ca3af' }}>
                        <div>{new Date(ret.createdAt).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})}</div>
                        {ret.totalAmount != null && ret.totalAmount > 0 &&
                          <div style={{ fontWeight:600, color:'#374151' }}>{ret.totalAmount.toFixed(2)}€</div>}
                      </div>
                      <StatusBadge status={ret.status} />
                      <span style={{ color:'#9ca3af', textAlign:'center', fontSize:16 }}>{expanded===ret.id ? '▾' : '▸'}</span>
                    </div>

                    {/* Expanded detail */}
                    {expanded === ret.id && (
                      <div style={{ padding:'20px 24px', background:'#fafafa', borderTop:'1px solid #e5e7eb' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>

                          {/* Left: items + tracking */}
                          <div>
                            {ret.trackingNumber && (
                              <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10,
                                padding:'12px 16px', marginBottom:14 }}>
                                <div style={{ fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase',
                                  letterSpacing:'0.05em', marginBottom:4 }}>Tracking</div>
                                <div style={{ fontSize:14, fontWeight:600, color:'#111827' }}>
                                  {ret.trackingNumber}{ret.carrier ? ` · ${ret.carrier}` : ''}
                                </div>
                              </div>
                            )}

                            {ret.labelUrl && (
                              <a href={`${API_URL}${ret.labelUrl}`} target="_blank" rel="noopener noreferrer"
                                style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom:14,
                                  padding:'8px 14px', background:'#fff', border:'1px solid #e5e7eb',
                                  borderRadius:8, fontSize:13, fontWeight:500, color:'#111827', textDecoration:'none' }}>
                                📥 Etiqueta PDF
                              </a>
                            )}

                            <div style={{ fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase',
                              letterSpacing:'0.05em', marginBottom:10 }}>Artículos</div>
                            {ret.items.map(item => (
                              <div key={item.id} style={{ display:'flex', alignItems:'center', gap:10,
                                padding:'10px 0', borderBottom:'1px solid #f3f4f6', fontSize:14 }}>
                                {item.orderItem.imageUrl &&
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={item.orderItem.imageUrl} alt="" style={{ width:40, height:40, objectFit:'cover', borderRadius:6 }} />}
                                <div style={{ flex:1 }}>
                                  <div style={{ fontWeight:500, color:'#111827' }}>{item.orderItem.title}
                                    {item.orderItem.variantTitle && <span style={{ color:'#9ca3af' }}> — {item.orderItem.variantTitle}</span>}
                                  </div>
                                  <div style={{ fontSize:12, color:'#6b7280' }}>
                                    {REASON_LABELS[item.reason] ?? item.reason}
                                    {item.replacementTitle && ` → ${item.replacementTitle} (${item.replacementPrice?.toFixed(2)}€)`}
                                  </div>
                                </div>
                                <span style={{ fontSize:13, color:'#9ca3af', fontWeight:600 }}>×{item.quantity}</span>
                              </div>
                            ))}

                            <PhotoSection returnId={ret.id} token={token} />
                          </div>

                          {/* Right: actions + verify + refund */}
                          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

                            {/* Verification */}
                            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:'16px' }}>
                              <div style={{ fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase',
                                letterSpacing:'0.05em', marginBottom:12 }}>📦 Verificación</div>
                              {ret.verificationStatus ? (
                                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                                  <span style={{ fontSize:13, fontWeight:700, padding:'4px 12px', borderRadius:20,
                                    background: ret.verificationStatus==='OK' ? '#d1fae5' : '#fee2e2',
                                    color: ret.verificationStatus==='OK' ? '#065f46' : '#991b1b' }}>
                                    {ret.verificationStatus==='OK' ? '✅ Correcto' : '⚠️ Incidencia'}
                                  </span>
                                  {ret.verificationNotes && <span style={{ fontSize:13, color:'#6b7280' }}>{ret.verificationNotes}</span>}
                                  {ret.verifiedAt && <span style={{ fontSize:11, color:'#9ca3af', marginLeft:'auto' }}>
                                    {new Date(ret.verifiedAt).toLocaleDateString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
                                  </span>}
                                </div>
                              ) : ret.status === 'RECEIVED' ? (
                                <VerifyPanel returnId={ret.id} onVerify={verifyReturn} />
                              ) : (
                                <div style={{ fontSize:13, color:'#9ca3af' }}>
                                  {ret.receivedAt
                                    ? `Recibido ${new Date(ret.receivedAt).toLocaleDateString('es-ES')}`
                                    : 'Pendiente de recibir'}
                                </div>
                              )}
                            </div>

                            {/* Refund status */}
                            {ret.status === 'APPROVED' && (
                              <div style={{ padding:'12px 14px', borderRadius:10,
                                background: ret.refundedAt ? '#d1fae5' : '#fef3c7',
                                border: `1px solid ${ret.refundedAt ? '#a7f3d0' : '#fde68a'}` }}>
                                {ret.refundedAt ? (
                                  <span style={{ fontSize:13, fontWeight:600, color:'#065f46' }}>
                                    ✓ Reembolso enviado {new Date(ret.refundedAt).toLocaleDateString('es-ES')}
                                    {ret.shopifyRefundAmount != null && ` · ${ret.shopifyRefundAmount.toFixed(2)}€`}
                                  </span>
                                ) : (
                                  <span style={{ fontSize:13, fontWeight:600, color:'#92400e' }}>
                                    ⏳ Reembolso pendiente en Shopify
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Status actions */}
                            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:'16px' }}>
                              <div style={{ fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase',
                                letterSpacing:'0.05em', marginBottom:12 }}>Cambiar estado</div>
                              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                                {Object.entries(STATUS_META).filter(([k]) => k !== ret.status).map(([key, meta]) => (
                                  <button key={key} onClick={() => updateStatus(ret.id, key)}
                                    style={{ padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer',
                                      color: meta.color, background: meta.bg,
                                      border: `1px solid ${meta.dot}44`, borderRadius:20 }}>
                                    {meta.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── TAB: CONFIG ── */}
        {tab === 'config' && configDraft && !loading && (
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:28, maxWidth:700 }}>
            <h2 style={{ margin:'0 0 20px', fontSize:18, fontWeight:700, color:'#111827' }}>Configuración del sistema</h2>

            <label style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px',
              background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:10, marginBottom:20, cursor:'pointer' }}>
              <input type="checkbox" checked={configDraft.enabled}
                onChange={e => setDraft({...configDraft, enabled:e.target.checked})}
                style={{ width:18, height:18, accentColor:'#111827' }} />
              <div>
                <div style={{ fontWeight:600, fontSize:14, color:'#111827' }}>Sistema de devoluciones activo</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>Desactiva para pausar el portal completamente</div>
              </div>
              <span style={{ marginLeft:'auto', fontSize:12, fontWeight:600, padding:'3px 10px', borderRadius:20,
                background: configDraft.enabled ? '#d1fae5' : '#fee2e2',
                color: configDraft.enabled ? '#065f46' : '#991b1b' }}>
                {configDraft.enabled ? 'Activo' : 'Pausado'}
              </span>
            </label>

            <div style={{ height:1, background:'#f3f4f6', margin:'0 0 20px' }} />

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
              <label style={cfgLabel}>
                <span>Plazo de devolución (días)</span>
                <input type="number" min={1} max={365} style={inp}
                  value={configDraft.windowDays}
                  onChange={e => setDraft({...configDraft, windowDays:Number(e.target.value)})} />
              </label>
              <label style={cfgLabel}>
                <span>Precio etiqueta (€)</span>
                <input type="number" step="0.01" min={0} style={inp}
                  value={configDraft.labelPrice}
                  onChange={e => setDraft({...configDraft, labelPrice:Number(e.target.value)})} />
              </label>
              <label style={cfgLabel}>
                <span>Política de cambios</span>
                <select style={inp} value={configDraft.exchangePolicy}
                  onChange={e => setDraft({...configDraft, exchangePolicy:e.target.value as 'ANY'|'SAME_TYPE'|'VARIANT_ONLY'})}>
                  <option value="ANY">Cualquier producto</option>
                  <option value="SAME_TYPE">Mismo tipo</option>
                  <option value="VARIANT_ONLY">Solo otra variante</option>
                </select>
              </label>
              <label style={cfgLabel}>
                <span>Código SendCloud retorno</span>
                <input type="text" style={inp} value={configDraft.shippingProductCode ?? ''}
                  placeholder="correos:paqretorno"
                  onChange={e => setDraft({...configDraft, shippingProductCode:e.target.value||null})} />
              </label>
            </div>

            <label style={{ ...cfgLabel, marginBottom:24 }}>
              <span>Texto términos legales (opcional)</span>
              <textarea style={{ ...inp, minHeight:90, resize:'vertical', fontFamily:'inherit' }}
                value={configDraft.termsText ?? ''}
                onChange={e => setDraft({...configDraft, termsText:e.target.value||null})}
                placeholder="Se mostrará al cliente en el portal..." />
            </label>

            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setDraft(config)} style={btnSecondary}>Descartar</button>
              <button onClick={saveConfig} disabled={savingConfig || JSON.stringify(config)===JSON.stringify(configDraft)}
                style={{ ...btnPrimary, flex:1, marginTop:0,
                  opacity: (savingConfig || JSON.stringify(config)===JSON.stringify(configDraft)) ? 0.5 : 1 }}>
                {savingConfig ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}

        {/* ── TAB: EXCEPTIONS ── */}
        {tab === 'exceptions' && !loading && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ fontSize:14, color:'#6b7280' }}>{exceptions.length} excepcion{exceptions.length!==1?'es':''}</div>
              <button onClick={() => setShowNewEx(true)} style={{ ...btnPrimary, marginTop:0, width:'auto', padding:'9px 18px' }}>
                + Nueva excepción
              </button>
            </div>

            {exceptions.length === 0 ? (
              <div style={{ textAlign:'center', color:'#9ca3af', padding:80, background:'#fff',
                border:'1px solid #e5e7eb', borderRadius:12 }}>
                Sin excepciones. Crea una para extender plazos, regalar etiquetas o bloquear devoluciones.
              </div>
            ) : (
              <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'#f9fafb', fontSize:11, textTransform:'uppercase', color:'#9ca3af', letterSpacing:'0.06em' }}>
                      {['Match','Tipo','Detalle','Expira','Estado',''].map((h,i) => (
                        <th key={i} style={{ padding:'10px 16px', textAlign:'left', fontWeight:600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.map((ex, i) => {
                      const meta = EXCEPTION_LABELS[ex.type];
                      return (
                        <tr key={ex.id} style={{ borderTop: i===0?'none':'1px solid #f3f4f6', fontSize:14 }}>
                          <td style={{ padding:'12px 16px' }}>
                            {ex.orderNumber && <div style={{ fontWeight:600, color:'#111827' }}>{ex.orderNumber}</div>}
                            {ex.customerEmail && <div style={{ fontSize:12, color:'#6b7280' }}>{ex.customerEmail}</div>}
                          </td>
                          <td style={{ padding:'12px 16px' }}>
                            <span style={{ fontSize:12, fontWeight:600, color:meta.color }}>{meta.label}</span>
                          </td>
                          <td style={{ padding:'12px 16px' }}>
                            {ex.type==='EXTEND_WINDOW' && <span>+{ex.extraDays} días</span>}
                            {ex.notes && <div style={{ fontSize:12, color:'#6b7280' }}>{ex.notes}</div>}
                          </td>
                          <td style={{ padding:'12px 16px', fontSize:12, color:'#9ca3af' }}>
                            {ex.expiresAt ? new Date(ex.expiresAt).toLocaleDateString('es-ES') : '—'}
                          </td>
                          <td style={{ padding:'12px 16px' }}>
                            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                              <input type="checkbox" checked={ex.active}
                                onChange={e => toggleException(ex.id, e.target.checked)}
                                style={{ accentColor:'#111827' }} />
                              <span style={{ fontSize:12, color: ex.active ? '#065f46' : '#9ca3af' }}>
                                {ex.active ? 'Activa' : 'Inactiva'}
                              </span>
                            </label>
                          </td>
                          <td style={{ padding:'12px 16px', textAlign:'right' }}>
                            <button onClick={() => deleteException(ex.id)}
                              style={{ padding:'5px 12px', fontSize:12, fontWeight:500, background:'transparent',
                                border:'1px solid #fca5a5', color:'#ef4444', borderRadius:8, cursor:'pointer' }}>
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

            {/* New exception modal */}
            {showNewEx && (
              <div onClick={() => setShowNewEx(false)} style={{ position:'fixed', inset:0,
                background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center',
                justifyContent:'center', padding:16, zIndex:100 }}>
                <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:14,
                  width:'100%', maxWidth:480, padding:28, boxShadow:'0 8px 40px rgba(0,0,0,0.16)' }}>
                  <h3 style={{ margin:'0 0 20px', fontSize:17, fontWeight:700, color:'#111827' }}>Nueva excepción</h3>

                  {[
                    { label:'Tipo', content: (
                      <select style={inp} value={newEx.type} onChange={e => setNewEx({...newEx, type:e.target.value})}>
                        <option value="EXTEND_WINDOW">Ampliar plazo</option>
                        <option value="FREE_LABEL">Etiqueta gratis</option>
                        <option value="ACCEPT_EXPIRED">Aceptar fuera de plazo</option>
                        <option value="BLOCK">Bloquear devolución</option>
                      </select>
                    )},
                    { label:'Número de pedido (opcional)', content: (
                      <input type="text" style={inp} placeholder="#12345" value={newEx.orderNumber}
                        onChange={e => setNewEx({...newEx, orderNumber:e.target.value})} />
                    )},
                    { label:'Email cliente (opcional)', content: (
                      <input type="email" style={inp} placeholder="cliente@email.com" value={newEx.customerEmail}
                        onChange={e => setNewEx({...newEx, customerEmail:e.target.value})} />
                    )},
                    ...(newEx.type === 'EXTEND_WINDOW' ? [{ label:'Días extra', content: (
                      <input type="number" min={1} max={365} style={inp} value={newEx.extraDays}
                        onChange={e => setNewEx({...newEx, extraDays:Number(e.target.value)})} />
                    )}] : []),
                    { label:'Notas internas', content: (
                      <input type="text" style={inp} placeholder="Ej: cliente VIP, error nuestro..." value={newEx.notes}
                        onChange={e => setNewEx({...newEx, notes:e.target.value})} />
                    )},
                    { label:'Expira (opcional)', content: (
                      <input type="date" style={inp} value={newEx.expiresAt}
                        onChange={e => setNewEx({...newEx, expiresAt:e.target.value})} />
                    )},
                  ].map((row, i) => (
                    <label key={i} style={{ ...cfgLabel, marginBottom:14 }}>
                      <span>{row.label}</span>
                      {row.content}
                    </label>
                  ))}

                  <div style={{ display:'flex', gap:10, marginTop:8 }}>
                    <button onClick={() => setShowNewEx(false)} style={btnSecondary}>Cancelar</button>
                    <button onClick={createException} style={{ ...btnPrimary, flex:1, marginTop:0 }}>Crear excepción</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inp: React.CSSProperties = {
  padding:'9px 12px', borderRadius:8, border:'1px solid #e5e7eb',
  fontSize:14, color:'#111827', background:'#fff', outline:'none', width:'100%',
};
const btnPrimary: React.CSSProperties = {
  marginTop:16, width:'100%', padding:'10px 20px',
  background:'#111827', color:'#fff', border:'none',
  borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding:'9px 16px', background:'#fff', color:'#374151',
  border:'1px solid #e5e7eb', borderRadius:8, fontSize:14, fontWeight:500, cursor:'pointer',
};
const cfgLabel: React.CSSProperties = {
  display:'flex', flexDirection:'column', gap:6,
  fontSize:13, fontWeight:500, color:'#374151',
};
