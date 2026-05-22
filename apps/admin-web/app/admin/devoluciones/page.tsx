'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  REQUESTED:     { label: 'Solicitada',       color: '#b45309', bg: '#fef3c7' },
  LABEL_CREATED: { label: 'Etiqueta creada',  color: '#1d4ed8', bg: '#dbeafe' },
  RECEIVED:      { label: 'Recibida',         color: '#6d28d9', bg: '#ede9fe' },
  APPROVED:      { label: 'Aprobada',         color: '#047857', bg: '#d1fae5' },
  REJECTED:      { label: 'Rechazada',        color: '#b91c1c', bg: '#fee2e2' },
  CANCELLED:     { label: 'Cancelada',        color: '#64748b', bg: '#f1f5f9' }
};

const REASON_LABELS: Record<string, string> = {
  WRONG_SIZE: 'Talla incorrecta',
  DEFECTIVE: 'Defectuoso',
  NOT_AS_DESCRIBED: 'No coincide',
  CHANGED_MIND: 'Cambio opinión',
  WRONG_ITEM: 'Artículo incorrecto',
  OTHER: 'Otro'
};

const EXCEPTION_LABELS: Record<string, { label: string; color: string }> = {
  EXTEND_WINDOW: { label: 'Ampliar plazo', color: '#1d4ed8' },
  FREE_LABEL: { label: 'Etiqueta gratis', color: '#047857' },
  ACCEPT_EXPIRED: { label: 'Aceptar expirado', color: '#b45309' },
  BLOCK: { label: 'Bloqueado', color: '#b91c1c' }
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
  createdAt: string;
  receivedAt?: string | null;
  verifiedAt?: string | null;
  verificationStatus?: string | null;
  verificationNotes?: string | null;
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

type Tab = 'list' | 'config' | 'exceptions' | 'portal';

function VerifyPanel({ returnId, onVerify }: { returnId: string; onVerify: (id: string, status: 'OK' | 'ISSUE', notes?: string) => void }) {
  const [notes, setNotes] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        type="text"
        placeholder="Notas de verificación (opcional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13, width: '100%' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onVerify(returnId, 'OK', notes || undefined)}
          style={{ flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 700, background: '#d1fae5', color: '#047857', border: '1px solid #047857', borderRadius: 8, cursor: 'pointer' }}>
          ✅ Todo correcto
        </button>
        <button onClick={() => onVerify(returnId, 'ISSUE', notes || 'Incidencia detectada')}
          style={{ flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 700, background: '#fee2e2', color: '#b91c1c', border: '1px solid #b91c1c', borderRadius: 8, cursor: 'pointer' }}>
          ⚠️ Hay incidencia
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: '#64748b', bg: '#f1f5f9' };
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
      color: meta.color, background: meta.bg, whiteSpace: 'nowrap'
    }}>
      {meta.label}
    </span>
  );
}

export default function AdminDevolucionesPage() {
  const [tab, setTab] = useState<Tab>('list');
  const [token, setToken] = useState<string>('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // List state
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Config state
  const [config, setConfig] = useState<ReturnConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<ReturnConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Exceptions state
  const [exceptions, setExceptions] = useState<ReturnException[]>([]);
  const [showNewException, setShowNewException] = useState(false);
  const [newException, setNewException] = useState({
    orderNumber: '', customerEmail: '', type: 'EXTEND_WINDOW', extraDays: 7, notes: '', expiresAt: ''
  });

  useEffect(() => {
    // Support both old key and new login key
    const stored = localStorage.getItem('token') || localStorage.getItem('mitaller_token');
    if (stored) { setToken(stored); loadAll(stored); }
    else { window.location.href = '/login'; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (token) loadAll(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadAll(jwt: string) {
    setLoading(true); setError(null);
    try {
      if (tab === 'list') {
        const r = await fetch(`${API_URL}/returns`, { headers: auth(jwt) });
        if (r.status === 401) { logout(); return; }
        setReturns(await r.json());
      } else if (tab === 'config') {
        const r = await fetch(`${API_URL}/returns/admin/config`, { headers: auth(jwt) });
        if (r.status === 401) { logout(); return; }
        const c = await r.json();
        setConfig(c); setConfigDraft(c);
      } else if (tab === 'exceptions') {
        const r = await fetch(`${API_URL}/returns/admin/exceptions`, { headers: auth(jwt) });
        if (r.status === 401) { logout(); return; }
        setExceptions(await r.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }

  function auth(t: string) { return { Authorization: `Bearer ${t}` }; }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('mitaller_token');
    document.cookie = 'admin-token=; path=/; max-age=0';
    window.location.href = '/login';
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    localStorage.setItem('token', tokenInput.trim());
    localStorage.setItem('mitaller_token', tokenInput.trim());
    setToken(tokenInput.trim());
    loadAll(tokenInput.trim());
  }

  async function updateStatus(returnId: string, status: string) {
    try {
      await fetch(`${API_URL}/returns/${returnId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify({ status })
      });
      loadAll(token);
    } catch (err) { alert(err instanceof Error ? err.message : 'Error'); }
  }

  async function saveConfig() {
    if (!configDraft) return;
    setSavingConfig(true);
    try {
      const res = await fetch(`${API_URL}/returns/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify(configDraft)
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setConfig(updated); setConfigDraft(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error guardando');
    } finally { setSavingConfig(false); }
  }

  async function createException() {
    if (!newException.orderNumber && !newException.customerEmail) {
      alert('Indica número de pedido o email');
      return;
    }
    try {
      const body: Record<string, unknown> = {
        type: newException.type,
        notes: newException.notes || undefined,
        expiresAt: newException.expiresAt || undefined
      };
      if (newException.orderNumber) body.orderNumber = newException.orderNumber;
      if (newException.customerEmail) body.customerEmail = newException.customerEmail;
      if (newException.type === 'EXTEND_WINDOW') body.extraDays = newException.extraDays;
      const res = await fetch(`${API_URL}/returns/admin/exceptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error((await res.json()).message ?? `Error ${res.status}`);
      setShowNewException(false);
      setNewException({ orderNumber: '', customerEmail: '', type: 'EXTEND_WINDOW', extraDays: 7, notes: '', expiresAt: '' });
      loadAll(token);
    } catch (err) { alert(err instanceof Error ? err.message : 'Error'); }
  }

  async function markReceived(returnId: string) {
    try {
      await fetch(`${API_URL}/returns/${returnId}/received`, {
        method: 'PATCH', headers: auth(token)
      });
      loadAll(token);
    } catch (err) { alert(err instanceof Error ? err.message : 'Error'); }
  }

  async function verifyReturn(returnId: string, verificationStatus: 'OK' | 'ISSUE', verificationNotes?: string) {
    try {
      await fetch(`${API_URL}/returns/${returnId}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify({ verificationStatus, verificationNotes })
      });
      loadAll(token);
    } catch (err) { alert(err instanceof Error ? err.message : 'Error'); }
  }

  async function toggleException(id: string, active: boolean) {
    await fetch(`${API_URL}/returns/admin/exceptions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ active })
    });
    loadAll(token);
  }

  async function deleteException(id: string) {
    if (!confirm('¿Borrar esta excepción?')) return;
    await fetch(`${API_URL}/returns/admin/exceptions/${id}`, { method: 'DELETE', headers: auth(token) });
    loadAll(token);
  }

  // ===== Login screen =====
  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '32px 28px', width: '100%', maxWidth: 360, boxShadow: 'var(--shadow-md)' }}>
          <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>Acceso admin</h2>
          <form onSubmit={handleLogin}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
              Token JWT
              <input type="password" style={inputStyle} value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="eyJ..." required />
            </label>
            <button type="submit" style={btnPrimaryStyle}>Entrar</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Devoluciones</h1>
        <button onClick={logout}
          style={{ ...btnSecondaryStyle, padding: '6px 12px' }}>Salir</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 20 }}>
        {[
          { id: 'list', label: 'Lista' },
          { id: 'config', label: 'Configuración' },
          { id: 'exceptions', label: 'Excepciones' },
          { id: 'portal', label: '⚙️ Portal' }
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id as Tab)}
            style={{
              padding: '10px 18px', background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: tab === t.id ? 600 : 500,
              color: tab === t.id ? 'var(--accent)' : 'var(--muted)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#b91c1c', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{error}</div>}

      {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>Cargando…</div>}

      {/* ===== TAB: LIST ===== */}
      {!loading && tab === 'list' && (
        returns.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>No hay devoluciones aún</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {returns.map((ret) => (
              <div key={ret.id} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' }}
                  onClick={() => setExpanded(expanded === ret.id ? null : ret.id)}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', minWidth: 70 }}>{ret.shopifyOrderNumber}</span>
                  <span style={pillType(ret.type)}>{ret.type === 'EXCHANGE' ? '🔄 Cambio' : '↩️ Devolución'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{ret.customerName}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ret.customerEmail}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>
                    <div>{new Date(ret.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</div>
                    <div>{ret.totalAmount != null ? `${ret.totalAmount.toFixed(2)}€` : ''}</div>
                  </div>
                  <StatusBadge status={ret.status} />
                  <span style={{ color: 'var(--muted)' }}>{expanded === ret.id ? '▾' : '▸'}</span>
                </div>
                {expanded === ret.id && (
                  <div style={{ borderTop: '1px solid var(--line-soft)', padding: 16, background: 'var(--surface-2)' }}>
                    {ret.trackingNumber && (
                      <div style={infoBoxStyle}>
                        <div style={infoLabelStyle}>Tracking</div>
                        <div style={infoValueStyle}>{ret.trackingNumber} {ret.carrier ? `· ${ret.carrier}` : ''}</div>
                      </div>
                    )}
                    {ret.labelUrl && (
                      <a href={`${API_URL}${ret.labelUrl}`} target="_blank" rel="noopener noreferrer"
                        style={{ ...btnSecondaryStyle, display: 'inline-block', marginBottom: 12 }}>📥 Etiqueta PDF</a>
                    )}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Artículos</div>
                      {ret.items.map((item) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 14 }}>
                          {item.orderItem.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.orderItem.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                          )}
                          <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 500 }}>{item.orderItem.title}</span>
                            {item.orderItem.variantTitle && <span style={{ color: 'var(--muted)' }}> — {item.orderItem.variantTitle}</span>}
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {REASON_LABELS[item.reason] ?? item.reason}
                              {item.replacementTitle && ` → ${item.replacementTitle} (${item.replacementPrice?.toFixed(2)}€)`}
                            </div>
                          </div>
                          <span style={{ color: 'var(--muted)', fontSize: 13 }}>x{item.quantity}</span>
                        </div>
                      ))}
                    </div>
                    {/* Verification panel */}
                    <div style={{ margin: '12px 0 16px', padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 10 }}>
                        📦 Verificación al recibir
                      </div>
                      {ret.verificationStatus ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
                            background: ret.verificationStatus === 'OK' ? '#d1fae5' : '#fee2e2',
                            color: ret.verificationStatus === 'OK' ? '#047857' : '#b91c1c'
                          }}>
                            {ret.verificationStatus === 'OK' ? '✅ Correcto' : '⚠️ Incidencia'}
                          </span>
                          {ret.verificationNotes && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{ret.verificationNotes}</span>}
                          {ret.verifiedAt && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{new Date(ret.verifiedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                      ) : ret.status === 'RECEIVED' ? (
                        <VerifyPanel returnId={ret.id} onVerify={verifyReturn} />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                            {ret.receivedAt ? `Recibido ${new Date(ret.receivedAt).toLocaleDateString('es-ES')}` : 'Pendiente de recibir'}
                          </span>
                          {!ret.receivedAt && ['LABEL_CREATED', 'REQUESTED'].includes(ret.status) && (
                            <button onClick={() => markReceived(ret.id)}
                              style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: '#ede9fe', color: '#6d28d9', border: '1px solid #6d28d933', borderRadius: 20, cursor: 'pointer' }}>
                              📬 Marcar como recibido
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>Cambiar estado:</span>
                      {Object.entries(STATUS_META).filter(([k]) => k !== ret.status).map(([key, meta]) => (
                        <button key={key} onClick={() => updateStatus(ret.id, key)}
                          style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33`, borderRadius: 20, cursor: 'pointer' }}>
                          {meta.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ===== TAB: CONFIG ===== */}
      {!loading && tab === 'config' && configDraft && (
        <div style={{ ...cardStyle, padding: 24 }}>
          <label style={configLabel}>
            <input type="checkbox" checked={configDraft.enabled}
              onChange={(e) => setConfigDraft({ ...configDraft, enabled: e.target.checked })}
              style={{ width: 18, height: 18, marginRight: 8, accentColor: 'var(--accent)' }} />
            <span style={{ fontWeight: 600 }}>Sistema de devoluciones activo</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>Desactiva para pausar todo el portal</span>
          </label>

          <div style={{ height: 1, background: 'var(--line)', margin: '20px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label style={configLabel}>
              <span>Plazo (días)</span>
              <input type="number" min={1} max={365} style={inputStyle} value={configDraft.windowDays}
                onChange={(e) => setConfigDraft({ ...configDraft, windowDays: Number(e.target.value) })} />
            </label>
            <label style={configLabel}>
              <span>Precio etiqueta (€)</span>
              <input type="number" step="0.01" min={0} style={inputStyle} value={configDraft.labelPrice}
                onChange={(e) => setConfigDraft({ ...configDraft, labelPrice: Number(e.target.value) })} />
            </label>
            <label style={configLabel}>
              <span>Política de cambios</span>
              <select style={inputStyle} value={configDraft.exchangePolicy}
                onChange={(e) => setConfigDraft({ ...configDraft, exchangePolicy: e.target.value as 'ANY' | 'SAME_TYPE' | 'VARIANT_ONLY' })}>
                <option value="ANY">Cualquier producto de la web</option>
                <option value="SAME_TYPE">Mismo tipo de producto</option>
                <option value="VARIANT_ONLY">Solo otra talla/variante</option>
              </select>
            </label>
            <label style={configLabel}>
              <span>Código SendCloud retorno</span>
              <input type="text" style={inputStyle} value={configDraft.shippingProductCode ?? ''}
                placeholder="correos:paqretorno"
                onChange={(e) => setConfigDraft({ ...configDraft, shippingProductCode: e.target.value || null })} />
            </label>
          </div>

          <label style={{ ...configLabel, marginTop: 16 }}>
            <span>Texto términos legales (opcional)</span>
            <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical', fontFamily: 'inherit' }}
              value={configDraft.termsText ?? ''}
              onChange={(e) => setConfigDraft({ ...configDraft, termsText: e.target.value || null })}
              placeholder="Texto que se mostrará al cliente en el portal..." />
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button onClick={() => setConfigDraft(config)} style={btnSecondaryStyle}>Descartar</button>
            <button onClick={saveConfig} disabled={savingConfig || JSON.stringify(config) === JSON.stringify(configDraft)}
              style={{ ...btnPrimaryStyle, flex: 1 }}>
              {savingConfig ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}

      {/* ===== TAB: PORTAL CONFIG ===== */}
      {tab === 'portal' && <PortalConfigTab token={token} apiUrl={API_URL} />}

      {/* ===== TAB: EXCEPTIONS ===== */}
      {!loading && tab === 'exceptions' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>{exceptions.length} excepciones</span>
            <button onClick={() => setShowNewException(true)} style={{ ...btnPrimaryStyle, padding: '8px 16px', marginTop: 0, width: 'auto' }}>
              + Nueva excepción
            </button>
          </div>

          {exceptions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>
              Sin excepciones. Crea una para extender plazos, regalar etiquetas o bloquear devoluciones.
            </div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }}>
                    <th style={th}>Match</th>
                    <th style={th}>Tipo</th>
                    <th style={th}>Detalle</th>
                    <th style={th}>Expira</th>
                    <th style={th}>Estado</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map((ex) => {
                    const meta = EXCEPTION_LABELS[ex.type];
                    return (
                      <tr key={ex.id} style={{ borderTop: '1px solid var(--line-soft)', fontSize: 14 }}>
                        <td style={td}>
                          {ex.orderNumber && <div style={{ fontWeight: 500 }}>{ex.orderNumber}</div>}
                          {ex.customerEmail && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ex.customerEmail}</div>}
                        </td>
                        <td style={td}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                        </td>
                        <td style={td}>
                          {ex.type === 'EXTEND_WINDOW' && <span>+{ex.extraDays} días</span>}
                          {ex.notes && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ex.notes}</div>}
                        </td>
                        <td style={{ ...td, fontSize: 12, color: 'var(--muted)' }}>
                          {ex.expiresAt ? new Date(ex.expiresAt).toLocaleDateString('es-ES') : '—'}
                        </td>
                        <td style={td}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="checkbox" checked={ex.active}
                              onChange={(e) => toggleException(ex.id, e.target.checked)}
                              style={{ accentColor: 'var(--accent)' }} />
                            <span style={{ fontSize: 12 }}>{ex.active ? 'Activa' : 'Inactiva'}</span>
                          </label>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button onClick={() => deleteException(ex.id)}
                            style={{ ...btnSecondaryStyle, padding: '4px 10px', fontSize: 12, color: 'var(--danger)' }}>Borrar</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* New Exception Modal */}
          {showNewException && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100
            }} onClick={() => setShowNewException(false)}>
              <div onClick={(e) => e.stopPropagation()} style={{
                background: 'var(--surface)', borderRadius: 'var(--radius)', width: '100%',
                maxWidth: 480, padding: 24
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Nueva excepción</h3>

                <label style={configLabel}>
                  <span>Tipo</span>
                  <select style={inputStyle} value={newException.type}
                    onChange={(e) => setNewException({ ...newException, type: e.target.value })}>
                    <option value="EXTEND_WINDOW">Ampliar plazo</option>
                    <option value="FREE_LABEL">Etiqueta gratis</option>
                    <option value="ACCEPT_EXPIRED">Aceptar fuera de plazo</option>
                    <option value="BLOCK">Bloquear devolución</option>
                  </select>
                </label>

                <label style={{ ...configLabel, marginTop: 12 }}>
                  <span>Número de pedido (opcional)</span>
                  <input type="text" style={inputStyle} placeholder="#12345" value={newException.orderNumber}
                    onChange={(e) => setNewException({ ...newException, orderNumber: e.target.value })} />
                </label>

                <label style={{ ...configLabel, marginTop: 12 }}>
                  <span>Email cliente (opcional)</span>
                  <input type="email" style={inputStyle} placeholder="cliente@email.com" value={newException.customerEmail}
                    onChange={(e) => setNewException({ ...newException, customerEmail: e.target.value })} />
                </label>

                {newException.type === 'EXTEND_WINDOW' && (
                  <label style={{ ...configLabel, marginTop: 12 }}>
                    <span>Días extra</span>
                    <input type="number" min={1} max={365} style={inputStyle} value={newException.extraDays}
                      onChange={(e) => setNewException({ ...newException, extraDays: Number(e.target.value) })} />
                  </label>
                )}

                <label style={{ ...configLabel, marginTop: 12 }}>
                  <span>Motivo / notas internas</span>
                  <input type="text" style={inputStyle} placeholder="Ej: cliente VIP, error nuestro, etc." value={newException.notes}
                    onChange={(e) => setNewException({ ...newException, notes: e.target.value })} />
                </label>

                <label style={{ ...configLabel, marginTop: 12 }}>
                  <span>Expira (opcional)</span>
                  <input type="date" style={inputStyle} value={newException.expiresAt}
                    onChange={(e) => setNewException({ ...newException, expiresAt: e.target.value })} />
                </label>

                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button onClick={() => setShowNewException(false)} style={btnSecondaryStyle}>Cancelar</button>
                  <button onClick={createException} style={{ ...btnPrimaryStyle, flex: 1, marginTop: 0 }}>Crear excepción</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PortalConfigTab({ token, apiUrl }: { token: string; apiUrl: string }) {
  const [config, setConfig] = useState({
    logoUrl: '', backgroundUrl: '', primaryColor: '#007AFF',
    cardStyle: 'light', titleText: 'Cambios & Devoluciones',
    subtitleText: 'Gestiona tu devolución de forma rápida', policyUrl: ''
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/portal-config`)
      .then(r => r.json()).then(data => setConfig(c => ({ ...c, ...data }))).catch(() => {});
  }, [apiUrl]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`${apiUrl}/portal-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(config)
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  return (
    <div style={{ maxWidth: 560, padding: '24px 0' }}>
      <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>Configuración del Portal</h3>

      {/* Logo URL */}
      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>URL del Logo</span>
        <input
          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14 }}
          placeholder="https://cdn.shopify.com/tu-logo.png"
          value={config.logoUrl || ''}
          onChange={e => setConfig(c => ({ ...c, logoUrl: e.target.value }))}
        />
        <span style={{ fontSize: 12, color: '#999', marginTop: 4, display: 'block' }}>
          Sube el logo a Shopify (Archivos) y pega la URL aquí
        </span>
      </label>

      {/* Background URL */}
      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>Imagen de fondo</span>
        <input
          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14 }}
          placeholder="https://cdn.shopify.com/tu-foto.jpg"
          value={config.backgroundUrl || ''}
          onChange={e => setConfig(c => ({ ...c, backgroundUrl: e.target.value }))}
        />
      </label>

      {/* Primary color + card style row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>Color principal</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={config.primaryColor || '#007AFF'}
              onChange={e => setConfig(c => ({ ...c, primaryColor: e.target.value }))}
              style={{ width: 44, height: 36, borderRadius: 6, border: '1.5px solid #ddd', cursor: 'pointer' }} />
            <input
              style={{ flex: 1, padding: '10px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14 }}
              value={config.primaryColor || '#007AFF'}
              onChange={e => setConfig(c => ({ ...c, primaryColor: e.target.value }))} />
          </div>
        </label>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>Estilo tarjeta</span>
          <select
            style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14 }}
            value={config.cardStyle || 'light'}
            onChange={e => setConfig(c => ({ ...c, cardStyle: e.target.value }))}>
            <option value="light">Blanca (light)</option>
            <option value="dark">Oscura (dark)</option>
          </select>
        </label>
      </div>

      {/* Title + Subtitle */}
      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>Título</span>
        <input
          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14 }}
          value={config.titleText || ''}
          onChange={e => setConfig(c => ({ ...c, titleText: e.target.value }))} />
      </label>
      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>Subtítulo</span>
        <input
          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14 }}
          value={config.subtitleText || ''}
          onChange={e => setConfig(c => ({ ...c, subtitleText: e.target.value }))} />
      </label>

      {/* Policy URL */}
      <label style={{ display: 'block', marginBottom: 24 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>URL política de devoluciones (opcional)</span>
        <input
          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #ddd', borderRadius: 8, fontSize: 14 }}
          placeholder="https://speedwear.es/policies/refund-policy"
          value={config.policyUrl || ''}
          onChange={e => setConfig(c => ({ ...c, policyUrl: e.target.value }))} />
      </label>

      {/* Save + Preview */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '12px 24px', background: '#6366f1', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
            opacity: saving ? 0.6 : 1
          }}>
          {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar cambios'}
        </button>
        <a
          href="/devoluciones"
          target="_blank"
          style={{ fontSize: 14, color: '#6366f1', textDecoration: 'none' }}>
          Ver portal →
        </a>
      </div>
    </div>
  );
}

// Styles
const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)',
  fontSize: 14, color: 'var(--ink)', background: 'var(--surface)', outline: 'none', width: '100%'
};
const btnPrimaryStyle: React.CSSProperties = {
  marginTop: 20, width: '100%', padding: '10px 20px',
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer'
};
const btnSecondaryStyle: React.CSSProperties = {
  padding: '8px 14px', background: 'var(--surface)', color: 'var(--ink)',
  border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', textDecoration: 'none', textAlign: 'center'
};
const cardStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)'
};
const configLabel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 14, fontWeight: 500, color: 'var(--ink-soft)'
};
const infoBoxStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--line)',
  borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'inline-block'
};
const infoLabelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 };
const infoValueStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500 };
const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 600 };
const td: React.CSSProperties = { padding: '12px 14px' };
const pillType = (type: string): React.CSSProperties => ({
  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
  background: type === 'EXCHANGE' ? '#ede9fe' : '#dbeafe',
  color: type === 'EXCHANGE' ? '#6d28d9' : '#1d4ed8',
  whiteSpace: 'nowrap'
});
