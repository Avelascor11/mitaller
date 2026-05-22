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

    const hasExchange = selectedEntries.some(([, s]) => s.action === 'EXCHANGE');
    const type: Action = hasExchange ? 'EXCHANGE' : 'RETURN';

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
    <>
      <style>{`
        :root {
          --ios-blue: #007AFF;
          --ios-green: #34C759;
          --ios-orange: #FF9500;
          --ios-red: #FF3B30;
          --ios-bg: #333333;
          --ios-white: #3D3D3D;
          --ios-text: #FFFFFF;
          --ios-secondary: rgba(255,255,255,0.55);
          --ios-separator: rgba(255,255,255,0.15);
          --ios-label2: rgba(255,255,255,0.7);
          --ios-fill: rgba(255,255,255,0.08);
          --ios-blue-soft: rgba(0,122,255,0.18);
          --ios-green-soft: rgba(52,199,89,0.15);
          --ios-red-soft: rgba(255,59,48,0.15);
          --ios-orange-soft: rgba(255,149,0,0.15);
        }
        * { box-sizing: border-box; }
        body { background: var(--ios-bg); }
        .ios-page {
          min-height: 100vh;
          background: var(--ios-bg);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 48px 16px 40px;
          font-family: -apple-system, 'SF Pro Display', 'SF Pro Text', BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        }
        .ios-input {
          width: 100%;
          padding: 14px 16px;
          border-radius: 12px;
          border: 1.5px solid var(--ios-separator);
          background: var(--ios-white);
          font-size: 16px;
          color: var(--ios-text);
          outline: none;
          transition: border-color 0.15s;
          font-family: inherit;
          appearance: none;
          -webkit-appearance: none;
        }
        .ios-input:focus { border-color: var(--ios-blue); }
        .ios-input::placeholder { color: var(--ios-secondary); }
        .ios-btn-primary {
          width: 100%;
          padding: 16px 20px;
          background: var(--ios-blue);
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 17px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: -0.2px;
          font-family: inherit;
          transition: opacity 0.15s, transform 0.1s;
        }
        .ios-btn-primary:active { opacity: 0.85; transform: scale(0.99); }
        .ios-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .ios-btn-secondary {
          padding: 12px 18px;
          background: var(--ios-white);
          color: var(--ios-blue);
          border: 1.5px solid var(--ios-blue);
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: opacity 0.15s;
          text-align: center;
        }
        .ios-btn-secondary:active { opacity: 0.7; }
        .ios-card {
          background: var(--ios-white);
          border-radius: 16px;
          box-shadow: 0 2px 16px rgba(0,0,0,0.35);
          width: 100%;
          max-width: 480px;
          overflow: hidden;
        }
        .ios-card-wide { max-width: 720px; }
        .ios-error-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background: var(--ios-red-soft);
          border: 1px solid rgba(255,59,48,0.25);
          border-radius: 12px;
          padding: 12px 14px;
          color: var(--ios-red);
          font-size: 14px;
          font-weight: 500;
          margin-top: 12px;
        }
        .ios-error-dismiss {
          background: none;
          border: none;
          color: var(--ios-red);
          cursor: pointer;
          font-size: 16px;
          padding: 0;
          line-height: 1;
          margin-left: auto;
          flex-shrink: 0;
        }
        .ios-step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--ios-separator);
          transition: all 0.2s;
        }
        .ios-step-dot.active {
          width: 24px;
          border-radius: 4px;
          background: var(--ios-blue);
        }
        .ios-step-dot.done { background: var(--ios-green); }
        .ios-item-card {
          background: var(--ios-white);
          border-radius: 16px;
          box-shadow: 0 2px 16px rgba(0,0,0,0.35);
          overflow: hidden;
          transition: box-shadow 0.2s;
        }
        .ios-item-card.selected { box-shadow: 0 2px 16px rgba(0,122,255,0.18); }
        .ios-segment {
          display: flex;
          background: var(--ios-fill);
          border-radius: 9px;
          padding: 2px;
          gap: 2px;
        }
        .ios-segment-btn {
          flex: 1;
          padding: 8px 12px;
          border-radius: 7px;
          border: none;
          background: transparent;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          color: var(--ios-secondary);
          font-family: inherit;
          transition: all 0.15s;
        }
        .ios-segment-btn.active {
          background: var(--ios-white);
          color: var(--ios-blue);
          box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        }
        .ios-checkbox {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid var(--ios-separator);
          background: var(--ios-white);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.15s;
        }
        .ios-checkbox.checked {
          background: var(--ios-blue);
          border-color: var(--ios-blue);
        }
        .ios-checkbox-check {
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          line-height: 1;
        }
        .ios-image-placeholder {
          width: 56px;
          height: 56px;
          border-radius: 10px;
          background: var(--ios-fill);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 22px;
        }
        .ios-summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 15px;
          color: var(--ios-text);
        }
        .ios-summary-row.total {
          font-weight: 700;
          font-size: 17px;
          border-top: 1px solid var(--ios-separator);
          margin-top: 6px;
          padding-top: 12px;
        }
        .ios-select {
          width: 100%;
          padding: 14px 40px 14px 16px;
          border-radius: 12px;
          border: 1.5px solid var(--ios-separator);
          background: var(--ios-white);
          font-size: 15px;
          color: var(--ios-text);
          outline: none;
          font-family: inherit;
          appearance: none;
          -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23FFFFFF' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
          cursor: pointer;
          transition: border-color 0.15s;
        }
        .ios-select:focus { border-color: var(--ios-blue); }
        @keyframes shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .ios-spinner {
          width: 20px;
          height: 20px;
          border: 2.5px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          display: inline-block;
          animation: spin 0.7s linear infinite;
        }
        .ios-spinner-blue {
          width: 32px;
          height: 32px;
          border: 3px solid var(--ios-fill);
          border-top-color: var(--ios-blue);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          margin: 0 auto;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes success-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .ios-success-icon {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: var(--ios-green);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          animation: success-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .ios-success-checkmark {
          color: #fff;
          font-size: 36px;
          font-weight: 700;
          line-height: 1;
        }
        .ios-download-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 16px 20px;
          background: var(--ios-blue);
          color: #fff;
          border-radius: 10px;
          font-size: 17px;
          font-weight: 600;
          text-decoration: none;
          letter-spacing: -0.2px;
          transition: opacity 0.15s;
        }
        .ios-download-btn:active { opacity: 0.85; }
        .ios-tracking-chip {
          background: var(--ios-fill);
          border-radius: 10px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }
        .ios-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 0;
          z-index: 100;
        }
        .ios-modal {
          background: var(--ios-white);
          border-radius: 20px 20px 0 0;
          width: 100%;
          max-width: 720px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .ios-modal-handle {
          width: 36px;
          height: 5px;
          border-radius: 3px;
          background: var(--ios-separator);
          margin: 12px auto 0;
        }
        .ios-product-card {
          background: var(--ios-white);
          border: 1.5px solid var(--ios-separator);
          border-radius: 14px;
          padding: 12px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }
        .ios-product-card.expanded {
          border-color: var(--ios-blue);
          background: var(--ios-blue-soft);
        }
        .ios-variant-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 10px 12px;
          background: var(--ios-fill);
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          color: var(--ios-text);
          transition: background 0.12s;
        }
        .ios-variant-btn:active { background: var(--ios-separator); }
        .ios-replacement-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: var(--ios-green-soft);
          border-radius: 12px;
          border: 1px solid rgba(52,199,89,0.2);
        }
        .ios-section-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--ios-secondary);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 8px;
        }
      `}</style>

      <div className="ios-page">

        {/* Logo + Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ margin: '0 auto 16px', width: 80, height: 80 }}>
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* S */}
              <text x="6" y="58" fontFamily="-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif" fontSize="56" fontWeight="800" fill="white" letterSpacing="-4">SW</text>
            </svg>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.5, marginBottom: 6 }}>
            Devoluciones & Cambios
          </div>
          <div style={{ color: 'var(--ios-secondary)', fontSize: 15 }}>
            Gestiona tu devolución de forma rápida
          </div>
        </div>

        {/* Steps indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 28 }}>
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`ios-step-dot ${step === s ? 'active' : step > s ? 'done' : ''}`}
            />
          ))}
        </div>

        {/* Step labels */}
        <div style={{ fontSize: 13, color: 'var(--ios-secondary)', marginBottom: 24, fontWeight: 500 }}>
          {step === 1 && 'Paso 1 de 3 — Buscar pedido'}
          {step === 2 && 'Paso 2 de 3 — Seleccionar artículos'}
          {step === 3 && 'Paso 3 de 3 — Confirmación'}
        </div>

        <div className={`ios-card${step === 2 ? ' ios-card-wide' : ''}`} style={{ padding: '28px 24px' }}>

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <form onSubmit={handleLookup}>
              <div style={{ marginBottom: 28, textAlign: 'center' }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
                  Encuentra tu pedido
                </h2>
                <p style={{ margin: 0, color: 'var(--ios-secondary)', fontSize: 15, lineHeight: 1.5 }}>
                  Introduce el número de pedido y el email con el que realizaste la compra.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div className="ios-section-label">Número de pedido</div>
                  <input
                    className="ios-input"
                    type="text"
                    placeholder="#12345"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <div className="ios-section-label">Email</div>
                  <input
                    className="ios-input"
                    type="email"
                    placeholder="tu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="ios-error-banner">
                  <span>⚠</span>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button type="button" className="ios-error-dismiss" onClick={() => setError(null)}>✕</button>
                </div>
              )}

              <button
                type="submit"
                className="ios-btn-primary"
                style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                disabled={loading}
              >
                {loading ? <><span className="ios-spinner" />Buscando...</> : 'Buscar pedido'}
              </button>
            </form>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && lookup && (
            <form onSubmit={handleSubmitReturn}>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
                  Selecciona artículos
                </h2>
                <div style={{ color: 'var(--ios-secondary)', fontSize: 14 }}>
                  Pedido {lookup.orderNumber} · {lookup.customerName}
                  {lookup.deliveredAt && ` · Entregado hace ${lookup.daysSince} días`}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                {lookup.items.map((item) => {
                  const sel = selections[item.id];
                  if (!sel) return null;
                  return (
                    <div key={item.id} className={`ios-item-card${sel.selected ? ' selected' : ''}`}>
                      {/* Item header row */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px', cursor: 'pointer' }}
                        onClick={() => updateSelection(item.id, { selected: !sel.selected })}
                      >
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }}
                          />
                        ) : (
                          <div className="ios-image-placeholder">👕</div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ios-text)', marginBottom: 3, letterSpacing: -0.2 }}>
                            {item.title}
                          </div>
                          {item.variantTitle && (
                            <div style={{ fontSize: 13, color: 'var(--ios-secondary)', marginBottom: 2 }}>
                              {item.variantTitle}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {item.unitPrice != null && (
                              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ios-blue)' }}>
                                {item.unitPrice.toFixed(2)}€
                              </span>
                            )}
                            <span style={{ fontSize: 12, color: 'var(--ios-secondary)' }}>
                              ×{item.returnableQuantity} disponible{item.returnableQuantity !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>

                        <div
                          className={`ios-checkbox${sel.selected ? ' checked' : ''}`}
                          style={{ flexShrink: 0 }}
                        >
                          {sel.selected && <span className="ios-checkbox-check">✓</span>}
                        </div>
                      </div>

                      {/* Expanded options */}
                      {sel.selected && (
                        <div style={{ borderTop: '1px solid var(--ios-fill)', padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                          {/* Action segmented control */}
                          <div>
                            <div className="ios-section-label">Tipo de gestión</div>
                            <div className="ios-segment">
                              <button
                                type="button"
                                className={`ios-segment-btn${sel.action === 'RETURN' ? ' active' : ''}`}
                                onClick={() => updateSelection(item.id, { action: 'RETURN', replacement: undefined })}
                              >
                                Devolver
                              </button>
                              <button
                                type="button"
                                className={`ios-segment-btn${sel.action === 'EXCHANGE' ? ' active' : ''}`}
                                onClick={() => updateSelection(item.id, { action: 'EXCHANGE' })}
                              >
                                Cambiar
                              </button>
                            </div>
                          </div>

                          {/* Exchange replacement picker */}
                          {sel.action === 'EXCHANGE' && (
                            <div>
                              <div className="ios-section-label">Producto de cambio</div>
                              {sel.replacement ? (
                                <div className="ios-replacement-chip">
                                  {sel.replacement.imageUrl && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={sel.replacement.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                                  )}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ios-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {sel.replacement.title}
                                    </div>
                                    <div style={{ fontSize: 13, color: 'var(--ios-secondary)' }}>{sel.replacement.price.toFixed(2)}€</div>
                                  </div>
                                  <button
                                    type="button"
                                    className="ios-btn-secondary"
                                    style={{ padding: '8px 12px', fontSize: 13 }}
                                    onClick={() => openPicker(item.id)}
                                  >
                                    Cambiar
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="ios-btn-secondary"
                                  style={{ width: '100%', padding: '13px 16px' }}
                                  onClick={() => openPicker(item.id)}
                                >
                                  + Elegir producto de cambio
                                </button>
                              )}
                            </div>
                          )}

                          {/* Reason */}
                          <div>
                            <div className="ios-section-label">Motivo *</div>
                            <select
                              className="ios-select"
                              value={sel.reason}
                              onChange={(e) => updateSelection(item.id, { reason: e.target.value })}
                              required={sel.selected}
                            >
                              <option value="">Selecciona un motivo…</option>
                              {Object.entries(lookup.reasons).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                              ))}
                            </select>
                          </div>

                          {/* Notes */}
                          <div>
                            <div className="ios-section-label">Notas (opcional)</div>
                            <input
                              className="ios-input"
                              type="text"
                              placeholder="Ej: talla muy pequeña…"
                              value={sel.notes}
                              onChange={(e) => updateSelection(item.id, { notes: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Summary card */}
              {summary && summary.exchangeCount + summary.returnCount > 0 && (
                <div style={{
                  background: 'var(--ios-bg)',
                  borderRadius: 16,
                  padding: '16px 18px',
                  marginBottom: 20
                }}>
                  <div className="ios-section-label">Resumen</div>
                  {summary.exchangeCount > 0 && (
                    <>
                      <div className="ios-summary-row">
                        <span style={{ color: 'var(--ios-secondary)' }}>Reembolso por devuelto</span>
                        <span>−{summary.refund.toFixed(2)}€</span>
                      </div>
                      <div className="ios-summary-row">
                        <span style={{ color: 'var(--ios-secondary)' }}>Cargo por nuevo producto</span>
                        <span>+{summary.charge.toFixed(2)}€</span>
                      </div>
                      {summary.netDiff < 0 && (
                        <div className="ios-summary-row" style={{ color: 'var(--ios-green)', fontSize: 13 }}>
                          <span>Diferencia a favor</span>
                          <span>{Math.abs(summary.netDiff).toFixed(2)}€</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="ios-summary-row">
                    <span style={{ color: 'var(--ios-secondary)' }}>Etiqueta Correos</span>
                    <span>+{summary.labelFee.toFixed(2)}€</span>
                  </div>
                  <div className="ios-summary-row total">
                    <span>Total a pagar</span>
                    <span style={{ color: 'var(--ios-blue)' }}>{summary.totalToPay.toFixed(2)}€</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="ios-error-banner" style={{ marginBottom: 16 }}>
                  <span>⚠</span>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button type="button" className="ios-error-dismiss" onClick={() => setError(null)}>✕</button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="ios-btn-secondary"
                  style={{ flexShrink: 0 }}
                  onClick={() => { setStep(1); setError(null); }}
                >
                  Volver
                </button>
                <button
                  type="submit"
                  className="ios-btn-primary"
                  style={{ flex: 1, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                  disabled={loading || selectedCount === 0}
                >
                  {loading
                    ? <><span className="ios-spinner" />Procesando…</>
                    : `Continuar (${selectedCount} artículo${selectedCount !== 1 ? 's' : ''})`
                  }
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

        <div style={{ marginTop: 24, fontSize: 13, color: 'var(--ios-secondary)', textAlign: 'center' }}>
          ¿Problemas? Contáctanos en tu email de compra.
        </div>

        {/* ── Catalog Picker Modal ── */}
        {pickerForItem && (
          <div
            className="ios-modal-overlay"
            onClick={() => { setPickerForItem(null); setExpandedProduct(null); }}
          >
            <div
              className="ios-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ios-modal-handle" />

              <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ios-text)', flex: 1, letterSpacing: -0.3 }}>
                  Elige producto de cambio
                </div>
                <button
                  type="button"
                  onClick={() => { setPickerForItem(null); setExpandedProduct(null); }}
                  style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: 'var(--ios-fill)', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: 14, color: 'var(--ios-secondary)'
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: '0 16px 12px' }}>
                <input
                  className="ios-input"
                  type="text"
                  placeholder="Buscar producto…"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                />
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
                {catalogLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <div className="ios-spinner-blue" style={{ marginBottom: 12 }} />
                    <div style={{ color: 'var(--ios-secondary)', fontSize: 15 }}>Cargando productos…</div>
                  </div>
                ) : filteredCatalog.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--ios-secondary)', padding: 40, fontSize: 15 }}>
                    Sin resultados
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                    {filteredCatalog.slice(0, 100).map((product) => (
                      <div
                        key={product.id}
                        className={`ios-product-card${expandedProduct === product.id ? ' expanded' : ''}`}
                        onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                      >
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.imageUrl}
                            alt={product.title}
                            style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
                          />
                        ) : (
                          <div style={{ width: '100%', height: 110, background: 'var(--ios-fill)', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                            👕
                          </div>
                        )}
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ios-text)', marginBottom: 3, lineHeight: 1.3 }}>
                          {product.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ios-secondary)' }}>
                          Desde {product.variants[0]?.price?.toFixed(2)}€
                        </div>
                        {expandedProduct === product.id && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {product.variants.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                className="ios-variant-btn"
                                onClick={(e) => { e.stopPropagation(); pickReplacement(v, product); }}
                              >
                                <span style={{ fontWeight: 500 }}>{v.title}</span>
                                <span style={{ color: 'var(--ios-blue)', fontWeight: 600 }}>{v.price.toFixed(2)}€</span>
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
    </>
  );
}

function Step3({ result, pollStatus, polling, apiUrl, onReset }: {
  result: CreateReturnResponse | null;
  pollStatus: StatusResponse | null;
  polling: boolean;
  apiUrl: string;
  onReset: () => void;
}) {
  const isPaid = pollStatus?.paymentStatus === 'PAID' || result?.paymentStatus === 'PAID';
  const labelUrl = pollStatus?.labelUrl ?? null;
  const trackingNumber = pollStatus?.trackingNumber ?? null;

  if (polling && !isPaid) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ marginBottom: 20 }}>
          <div className="ios-spinner-blue" />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
          Confirmando pago…
        </h2>
        <p style={{ margin: 0, color: 'var(--ios-secondary)', fontSize: 15, lineHeight: 1.5 }}>
          Esperando confirmación de Shopify. La etiqueta se generará en cuanto recibamos el pago.
        </p>
      </div>
    );
  }

  if (isPaid && labelUrl) {
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div className="ios-success-icon">
            <span className="ios-success-checkmark">✓</span>
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
            ¡Etiqueta lista!
          </h2>
          <p style={{ margin: 0, color: 'var(--ios-secondary)', fontSize: 15, lineHeight: 1.5 }}>
            Tu pago se ha confirmado. Descarga, imprime y pega en el paquete.
          </p>
        </div>

        {trackingNumber && (
          <div className="ios-tracking-chip">
            <span style={{ fontSize: 20 }}>📦</span>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ios-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                Número de tracking
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ios-text)' }}>{trackingNumber}</div>
            </div>
          </div>
        )}

        <a
          href={labelUrl.startsWith('http') ? labelUrl : `${apiUrl}${labelUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ios-download-btn"
          style={{ marginBottom: 12 }}
        >
          <span style={{ fontSize: 20 }}>⬇</span>
          Descargar etiqueta PDF
        </a>

        <button type="button" className="ios-btn-secondary" style={{ width: '100%' }} onClick={onReset}>
          Nueva devolución
        </button>
      </div>
    );
  }

  if (result?.checkoutUrl) {
    const returnUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/devoluciones?return_id=${result.returnId}`;
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'var(--ios-blue-soft)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 32
          }}>
            💳
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
            Último paso: pagar
          </h2>
          <p style={{ margin: 0, color: 'var(--ios-secondary)', fontSize: 15, lineHeight: 1.5 }}>
            {result.type === 'EXCHANGE'
              ? 'Para procesar el cambio, paga la diferencia + etiqueta.'
              : 'Para procesar la devolución, paga la etiqueta de Correos.'}
          </p>
        </div>

        <div style={{ background: 'var(--ios-bg)', borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
          <div
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--ios-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}
          >
            Desglose
          </div>
          {result.type === 'EXCHANGE' && (
            <>
              <div className="ios-summary-row">
                <span style={{ color: 'var(--ios-secondary)' }}>Reembolso</span>
                <span>−{result.refundAmount?.toFixed(2) ?? '0.00'}€</span>
              </div>
              <div className="ios-summary-row">
                <span style={{ color: 'var(--ios-secondary)' }}>Cargo</span>
                <span>+{result.chargeAmount?.toFixed(2) ?? '0.00'}€</span>
              </div>
            </>
          )}
          <div className="ios-summary-row">
            <span style={{ color: 'var(--ios-secondary)' }}>Etiqueta Correos</span>
            <span>+{result.labelFee?.toFixed(2) ?? '0.00'}€</span>
          </div>
          <div className="ios-summary-row total">
            <span>Total</span>
            <span style={{ color: 'var(--ios-blue)' }}>{result.totalAmount?.toFixed(2) ?? '0.00'}€</span>
          </div>
        </div>

        <a
          href={`${result.checkoutUrl}?return_url=${encodeURIComponent(returnUrl)}`}
          className="ios-download-btn"
          style={{ marginBottom: 12 }}
        >
          Pagar {result.totalAmount?.toFixed(2)}€
        </a>

        <p style={{ fontSize: 13, color: 'var(--ios-secondary)', textAlign: 'center', margin: '0 0 16px' }}>
          Serás redirigido al checkout seguro de Shopify. Al volver, tendrás tu etiqueta lista.
        </p>

        <button type="button" className="ios-btn-secondary" style={{ width: '100%' }} onClick={onReset}>
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div className="ios-spinner-blue" style={{ marginBottom: 12 }} />
      <p style={{ color: 'var(--ios-secondary)', fontSize: 15 }}>Cargando…</p>
    </div>
  );
}
