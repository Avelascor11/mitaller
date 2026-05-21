'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface OrderItem {
  id: string;
  sku: string;
  title: string;
  variantTitle?: string | null;
  quantity: number;
  returnableQuantity: number;
  imageUrl?: string | null;
  color?: string | null;
  size?: string | null;
  unitPrice?: number | null;
}

interface LookupResult {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  deliveredAt: string | null;
  referenceDate: string;
  daysSince: number;
  windowDays: number;
  windowExpired: boolean;
  labelFee: number;
  items: OrderItem[];
  reasons: Record<string, string>;
}

interface CatalogVariant {
  id: string;
  title: string;
  price: number;
  sku: string;
  available: boolean;
  imageUrl: string | null;
  size: string | null;
  color: string | null;
}
interface CatalogProduct {
  id: string;
  title: string;
  productType: string | null;
  handle: string;
  imageUrl: string | null;
  variants: CatalogVariant[];
}

interface CreateReturnResponse {
  returnId: string;
  type: string;
  status: string;
  paymentStatus: string;
  refundAmount: number | null;
  chargeAmount: number | null;
  labelFee: number | null;
  totalAmount: number | null;
  checkoutUrl: string | null;
  items: Array<{ title: string; variantTitle?: string | null; quantity: number; reason: string; replacementTitle?: string | null; replacementPrice?: number | null }>;
}

interface StatusResponse {
  returnId: string;
  type: string;
  status: string;
  paymentStatus: string;
  checkoutUrl: string | null;
  labelUrl: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  totalAmount: number | null;
  paidAt: string | null;
}

type Action = 'RETURN' | 'EXCHANGE';

interface ItemSelection {
  selected: boolean;
  action: Action;
  quantity: number;
  reason: string;
  notes: string;
  replacement?: { variantId: string; productId: string; title: string; price: number; imageUrl?: string };
}

export default function DevolucionesPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [selections, setSelections] = useState<Record<string, ItemSelection>>({});
  const [returnResult, setReturnResult] = useState<CreateReturnResponse | null>(null);

  // Exchange picker modal
  const [pickerForItem, setPickerForItem] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // After Shopify checkout: poll status
  const [polling, setPolling] = useState(false);
  const [pollStatus, setPollStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnId = params.get('return_id');
    if (returnId) {
      setPolling(true);
      setStep(3);
      const poll = async () => {
        try {
          const res = await fetch(`${API_URL}/returns/${returnId}/status`);
          if (!res.ok) return;
          const data = (await res.json()) as StatusResponse;
          setPollStatus(data);
          if (data.paymentStatus === 'PAID' && data.labelUrl) {
            setPolling(false);
          }
        } catch {}
      };
      poll();
      const interval = setInterval(poll, 5000);
      return () => clearInterval(interval);
    }
  }, []);

  async function loadCatalog() {
    if (catalog.length > 0) return;
    setCatalogLoading(true);
    try {
      const res = await fetch(`${API_URL}/returns/catalog`);
      const data = await res.json();
      setCatalog(Array.isArray(data) ? data : []);
    } catch {
      setError('No se pudo cargar el catálogo de productos.');
    } finally {
      setCatalogLoading(false);
    }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/returns/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: orderNumber.trim(), email: email.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Error al buscar pedido');
      const lr = data as LookupResult;
      if (lr.windowExpired) {
        setError(`Han pasado ${lr.daysSince} días desde la entrega. El plazo de devolución es ${lr.windowDays} días.`);
        setLoading(false);
        return;
      }
      setLookup(lr);
      const initial: Record<string, ItemSelection> = {};
      for (const item of lr.items) {
        initial[item.id] = { selected: false, action: 'RETURN', quantity: 1, reason: '', notes: '' };
      }
      setSelections(initial);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  function updateSelection(itemId: string, patch: Partial<ItemSelection>) {
    setSelections((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  function openPicker(itemId: string) {
    setPickerForItem(itemId);
    loadCatalog();
  }

  function pickReplacement(variant: CatalogVariant, product: CatalogProduct) {
    if (!pickerForItem) return;
    updateSelection(pickerForItem, {
      replacement: {
        variantId: variant.id,
        productId: product.id,
        title: `${product.title} — ${variant.title}`,
        price: variant.price,
        imageUrl: variant.imageUrl ?? product.imageUrl ?? undefined
      }
    });
    setPickerForItem(null);
    setExpandedProduct(null);
  }

  async function handleSubmitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!lookup) return;
    setError(null);

    const selectedEntries = Object.entries(selections).filter(([, s]) => s.selected);
    if (selectedEntries.length === 0) {
      setError('Selecciona al menos un artículo.');
      return;
    }

    // Group by action type — for simplicity, the type is determined by whether ANY item is EXCHANGE
    const hasExchange = selectedEntries.some(([, s]) => s.action === 'EXCHANGE');
    const type: Action = hasExchange ? 'EXCHANGE' : 'RETURN';

    // Validate
    for (const [, s] of selectedEntries) {
      if (!s.reason) {
        setError('Elige un motivo para cada artículo.');
        return;
      }
      if (s.action === 'EXCHANGE' && !s.replacement) {
        setError('Elige producto de cambio para los artículos marcados como CAMBIO.');
        return;
      }
    }

    const items = selectedEntries.map(([id, s]) => ({
      orderItemId: id,
      quantity: s.quantity,
      reason: s.reason,
      notes: s.notes || undefined,
      ...(s.replacement
        ? {
            replacementVariantId: s.replacement.variantId,
            replacementProductId: s.replacement.productId,
            replacementTitle: s.replacement.title,
            replacementImageUrl: s.replacement.imageUrl,
            replacementPrice: s.replacement.price
          }
        : {})
    }));

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: lookup.orderNumber, email, type, items })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Error al procesar');
      setReturnResult(data as CreateReturnResponse);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  const selectedCount = Object.values(selections).filter((s) => s.selected).length;

  // Summary computation
  const summary = (() => {
    if (!lookup) return null;
    const selectedItems = Object.entries(selections).filter(([, s]) => s.selected);
    let refund = 0;
    let charge = 0;
    let exchangeCount = 0;
    for (const [id, s] of selectedItems) {
      const orig = lookup.items.find((i) => i.id === id);
      const origPrice = orig?.unitPrice ?? 0;
      refund += origPrice * s.quantity;
      if (s.action === 'EXCHANGE' && s.replacement) {
        charge += s.replacement.price * s.quantity;
        exchangeCount++;
      }
    }
    const labelFee = lookup.labelFee;
    const netDiff = charge - refund;
    const totalToPay = exchangeCount > 0 ? Math.max(0, netDiff) + labelFee : labelFee;
    return { refund, charge, labelFee, netDiff, totalToPay, exchangeCount, returnCount: selectedItems.length - exchangeCount };
  })();

  const filteredCatalog = catalog.filter((p) =>
    !catalogQuery || p.title.toLowerCase().includes(catalogQuery.toLowerCase())
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '40px 16px' }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Portal de Devoluciones</div>
        <div style={{ color: 'var(--muted)', fontSize: 15 }}>Gestiona tu devolución o cambio de forma rápida y sencilla</div>
      </div>

      {/* Steps indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Buscar pedido', 'Seleccionar artículos', 'Etiqueta lista'].map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: step === i + 1 ? 'var(--accent)' : step > i + 1 ? 'var(--success)' : 'var(--muted)',
              fontWeight: step === i + 1 ? 600 : 400,
              fontSize: 14
            }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                background: step === i + 1 ? 'var(--accent)' : step > i + 1 ? 'var(--success)' : 'var(--line)',
                color: step >= i + 1 ? '#fff' : 'var(--muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0
              }}>{step > i + 1 ? '✓' : i + 1}</span>
              <span>{label}</span>
            </div>
            {i < 2 && <div style={{ width: 32, height: 1, background: 'var(--line)' }} />}
          </div>
        ))}
      </div>

      <div style={{
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        border: '1px solid var(--line)',
        width: '100%',
        maxWidth: step === 2 ? 720 : 560,
        padding: '32px 28px'
      }}>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <form onSubmit={handleLookup}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700 }}>Encuentra tu pedido</h2>
            <p style={{ margin: '0 0 24px', color: 'var(--muted)', fontSize: 14 }}>
              Introduce el número de pedido y el email con el que realizaste la compra.
            </p>

            <label style={labelStyle}>
              Número de pedido
              <input style={inputStyle} type="text" placeholder="#12345" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} required />
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Email
              <input style={inputStyle} type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>

            {error && <div style={errorStyle}>{error}</div>}

            <button type="submit" style={btnPrimaryStyle} disabled={loading}>
              {loading ? 'Buscando...' : 'Buscar pedido →'}
            </button>
          </form>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && lookup && (
          <form onSubmit={handleSubmitReturn}>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Selecciona los artículos</h2>
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                Pedido {lookup.orderNumber} · {lookup.customerName}
                {lookup.deliveredAt && ` · Entregado hace ${lookup.daysSince} días`}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {lookup.items.map((item) => {
                const sel = selections[item.id];
                if (!sel) return null;
                return (
                  <div key={item.id} style={{
                    border: `2px solid ${sel.selected ? 'var(--accent)' : 'var(--line)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    background: sel.selected ? 'var(--accent-soft)' : 'var(--surface-2)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      {item.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt={item.title} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                          <input type="checkbox" checked={sel.selected}
                            onChange={(e) => updateSelection(item.id, { selected: e.target.checked })}
                            style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                          <span style={{ fontWeight: 600, fontSize: 14 }}>
                            {item.title}{item.variantTitle ? ` — ${item.variantTitle}` : ''}
                          </span>
                          {item.unitPrice != null && (
                            <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 'auto' }}>
                              {item.unitPrice.toFixed(2)}€
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 26 }}>
                          x{item.returnableQuantity} disponible{item.returnableQuantity !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>

                    {sel.selected && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Tipo de acción */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button"
                            onClick={() => updateSelection(item.id, { action: 'RETURN', replacement: undefined })}
                            style={pillStyle(sel.action === 'RETURN')}>
                            ↩️ Devolución
                          </button>
                          <button type="button"
                            onClick={() => updateSelection(item.id, { action: 'EXCHANGE' })}
                            style={pillStyle(sel.action === 'EXCHANGE')}>
                            🔄 Cambio
                          </button>
                        </div>

                        {/* Selector cambio */}
                        {sel.action === 'EXCHANGE' && (
                          <div>
                            {sel.replacement ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'var(--success-soft)', borderRadius: 6 }}>
                                {sel.replacement.imageUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={sel.replacement.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                                )}
                                <div style={{ flex: 1, fontSize: 13 }}>
                                  <div style={{ fontWeight: 600 }}>{sel.replacement.title}</div>
                                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{sel.replacement.price.toFixed(2)}€</div>
                                </div>
                                <button type="button" onClick={() => openPicker(item.id)}
                                  style={{ ...btnSecondaryStyle, padding: '6px 10px', fontSize: 12 }}>Cambiar</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => openPicker(item.id)} style={{ ...btnSecondaryStyle, width: '100%' }}>
                                + Elegir producto de cambio
                              </button>
                            )}
                          </div>
                        )}

                        {/* Motivo */}
                        <label style={{ ...labelStyle, margin: 0 }}>
                          <span style={{ fontSize: 12 }}>Motivo *</span>
                          <select style={{ ...inputStyle, fontSize: 13 }} value={sel.reason}
                            onChange={(e) => updateSelection(item.id, { reason: e.target.value })} required={sel.selected}>
                            <option value="">Selecciona motivo…</option>
                            {Object.entries(lookup.reasons).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </label>

                        <label style={{ ...labelStyle, margin: 0 }}>
                          <span style={{ fontSize: 12 }}>Notas (opcional)</span>
                          <input style={{ ...inputStyle, fontSize: 13 }} type="text"
                            placeholder="Ej: talla muy pequeña…"
                            value={sel.notes}
                            onChange={(e) => updateSelection(item.id, { notes: e.target.value })} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Resumen importe */}
            {summary && summary.exchangeCount + summary.returnCount > 0 && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', marginBottom: 16, fontSize: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Resumen</div>
                {summary.exchangeCount > 0 && (
                  <>
                    <div style={summaryRow}><span>Reembolso por devuelto</span><span>−{summary.refund.toFixed(2)}€</span></div>
                    <div style={summaryRow}><span>Cargo por nuevo producto</span><span>+{summary.charge.toFixed(2)}€</span></div>
                    {summary.netDiff < 0 && (
                      <div style={{ ...summaryRow, color: 'var(--success)', fontSize: 12 }}>
                        <span>Diferencia a favor (se reembolsa al recibir)</span><span>{Math.abs(summary.netDiff).toFixed(2)}€</span>
                      </div>
                    )}
                  </>
                )}
                <div style={summaryRow}><span>Etiqueta Correos</span><span>+{summary.labelFee.toFixed(2)}€</span></div>
                <div style={{ ...summaryRow, fontWeight: 700, fontSize: 15, paddingTop: 8, borderTop: '1px solid var(--line)', marginTop: 6 }}>
                  <span>Total a pagar</span><span>{summary.totalToPay.toFixed(2)}€</span>
                </div>
              </div>
            )}

            {error && <div style={errorStyle}>{error}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" style={btnSecondaryStyle} onClick={() => { setStep(1); setError(null); }}>← Volver</button>
              <button type="submit" style={{ ...btnPrimaryStyle, flex: 1, marginTop: 0 }} disabled={loading || selectedCount === 0}>
                {loading ? 'Procesando…' : `Continuar al pago (${selectedCount})`}
              </button>
            </div>
          </form>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <Step3
            result={returnResult}
            pollStatus={pollStatus}
            polling={polling}
            apiUrl={API_URL}
            onReset={() => {
              setStep(1); setOrderNumber(''); setEmail(''); setLookup(null);
              setSelections({}); setReturnResult(null); setPollStatus(null); setError(null);
              window.history.replaceState({}, '', '/devoluciones');
            }}
          />
        )}
      </div>

      <div style={{ marginTop: 24, fontSize: 12, color: 'var(--muted-soft)', textAlign: 'center' }}>
        ¿Problemas? Contáctanos en tu email de compra.
      </div>

      {/* ── Catalog Picker Modal ── */}
      {pickerForItem && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100
        }} onClick={() => { setPickerForItem(null); setExpandedProduct(null); }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--surface)', borderRadius: 'var(--radius)', width: '100%',
            maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Elige producto de cambio</div>
              <button type="button" onClick={() => { setPickerForItem(null); setExpandedProduct(null); }}
                style={{ ...btnSecondaryStyle, padding: '4px 10px', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
              <input style={inputStyle} type="text" placeholder="Buscar producto…"
                value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {catalogLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>Cargando productos…</div>
              ) : filteredCatalog.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>Sin resultados</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                  {filteredCatalog.slice(0, 100).map((product) => (
                    <div key={product.id} style={{
                      border: '1px solid var(--line)', borderRadius: 8, padding: 8, cursor: 'pointer',
                      background: expandedProduct === product.id ? 'var(--accent-soft)' : 'var(--surface)'
                    }} onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}>
                      {product.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.imageUrl} alt={product.title} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 4, marginBottom: 8 }} />
                      )}
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{product.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {product.variants[0]?.price?.toFixed(2)}€ · {product.variants.length} variante{product.variants.length !== 1 ? 's' : ''}
                      </div>
                      {expandedProduct === product.id && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {product.variants.map((v) => (
                            <button key={v.id} type="button"
                              onClick={(e) => { e.stopPropagation(); pickReplacement(v, product); }}
                              style={{ ...btnSecondaryStyle, padding: '6px 10px', fontSize: 12, justifyContent: 'space-between', display: 'flex' }}>
                              <span>{v.title}</span><span>{v.price.toFixed(2)}€</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Step3({ result, pollStatus, polling, apiUrl, onReset }: {
  result: CreateReturnResponse | null;
  pollStatus: StatusResponse | null;
  polling: boolean;
  apiUrl: string;
  onReset: () => void;
}) {
  // If returning from Shopify with return_id in URL, use pollStatus
  const isPaid = pollStatus?.paymentStatus === 'PAID' || result?.paymentStatus === 'PAID';
  const labelUrl = pollStatus?.labelUrl ?? null;
  const trackingNumber = pollStatus?.trackingNumber ?? null;

  if (polling && !isPaid) {
    return (
      <div style={{ textAlign: 'center', padding: 20 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Confirmando pago…</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
          Esperando confirmación de Shopify. La etiqueta se generará en cuanto recibamos el pago.
        </p>
      </div>
    );
  }

  if (isPaid && labelUrl) {
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--success-soft)', color: 'var(--success)',
            margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24
          }}>✓</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700 }}>¡Etiqueta lista!</h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Tu pago se ha confirmado. Descarga, imprime y pega en el paquete.
          </p>
        </div>

        {trackingNumber && (
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>Tracking: </span>
            <span style={{ fontWeight: 600 }}>{trackingNumber}</span>
          </div>
        )}

        <a href={labelUrl.startsWith('http') ? labelUrl : `${apiUrl}${labelUrl}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--accent)', color: '#fff',
            borderRadius: 'var(--radius-sm)', padding: '12px 20px',
            fontWeight: 600, fontSize: 15, textDecoration: 'none', marginBottom: 12
          }}>
          📥 Descargar etiqueta PDF
        </a>

        <button type="button" style={btnSecondaryStyle} onClick={onReset}>Nueva devolución</button>
      </div>
    );
  }

  // Pending payment — show checkout link
  if (result?.checkoutUrl) {
    const returnUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/devoluciones?return_id=${result.returnId}`;
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--accent-soft)', color: 'var(--accent)',
            margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24
          }}>💳</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700 }}>Último paso: pagar</h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            {result.type === 'EXCHANGE'
              ? 'Para procesar el cambio, paga la diferencia + etiqueta.'
              : 'Para procesar la devolución, paga la etiqueta de Correos.'}
          </p>
        </div>

        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', marginBottom: 16, fontSize: 14 }}>
          {result.type === 'EXCHANGE' && (
            <>
              <div style={summaryRow}><span>Reembolso</span><span>−{result.refundAmount?.toFixed(2) ?? '0.00'}€</span></div>
              <div style={summaryRow}><span>Cargo</span><span>+{result.chargeAmount?.toFixed(2) ?? '0.00'}€</span></div>
            </>
          )}
          <div style={summaryRow}><span>Etiqueta Correos</span><span>+{result.labelFee?.toFixed(2) ?? '0.00'}€</span></div>
          <div style={{ ...summaryRow, fontWeight: 700, fontSize: 16, paddingTop: 8, borderTop: '1px solid var(--line)', marginTop: 6 }}>
            <span>Total</span><span>{result.totalAmount?.toFixed(2) ?? '0.00'}€</span>
          </div>
        </div>

        <a href={`${result.checkoutUrl}?return_url=${encodeURIComponent(returnUrl)}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--accent)', color: '#fff',
            borderRadius: 'var(--radius-sm)', padding: '14px 20px',
            fontWeight: 600, fontSize: 16, textDecoration: 'none', marginBottom: 12
          }}>
          Pagar {result.totalAmount?.toFixed(2)}€ →
        </a>

        <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginBottom: 16 }}>
          Serás redirigido al checkout seguro de Shopify. Al volver, tendrás tu etiqueta lista.
        </p>

        <button type="button" style={btnSecondaryStyle} onClick={onReset}>Cancelar</button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: 20 }}>
      <p style={{ color: 'var(--muted)' }}>Cargando…</p>
    </div>
  );
}

// Styles
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 14, fontWeight: 500, color: 'var(--ink-soft)'
};
const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)',
  fontSize: 15, color: 'var(--ink)', background: 'var(--surface)', outline: 'none', width: '100%'
};
const btnPrimaryStyle: React.CSSProperties = {
  marginTop: 20, width: '100%', padding: '12px 20px',
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius-sm)', fontSize: 15, fontWeight: 600, cursor: 'pointer'
};
const btnSecondaryStyle: React.CSSProperties = {
  padding: '10px 16px', background: 'var(--surface)', color: 'var(--ink)',
  border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
  fontSize: 14, fontWeight: 500, cursor: 'pointer', textAlign: 'center'
};
const errorStyle: React.CSSProperties = {
  marginTop: 12, padding: '10px 14px', background: 'var(--danger-soft)',
  color: 'var(--danger)', borderRadius: 'var(--radius-sm)',
  fontSize: 14, border: '1px solid #fca5a5'
};
const summaryRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', padding: '4px 0'
};
const pillStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '8px 12px',
  background: active ? 'var(--accent)' : 'var(--surface)',
  color: active ? '#fff' : 'var(--ink)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
  borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer'
});
