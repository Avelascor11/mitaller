'use client';

import { use, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface ReturnStatus {
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

const STATUS_ORDER = ['REQUESTED', 'LABEL_CREATED', 'RECEIVED', 'APPROVED'];

const LABELS: Record<string, { es: string; en: string; icon: string }> = {
  REQUESTED:     { es: 'Solicitud recibida',          en: 'Request received',         icon: '📋' },
  LABEL_CREATED: { es: 'Etiqueta generada',            en: 'Label generated',           icon: '🏷️' },
  RECEIVED:      { es: 'Paquete recibido',             en: 'Package received',          icon: '📦' },
  APPROVED:      { es: 'Verificado · reembolso en proceso', en: 'Verified · refund in progress', icon: '✅' },
  REFUNDED:      { es: 'Reembolso completado',         en: 'Refund completed',          icon: '💰' },
  REJECTED:      { es: 'Solicitud rechazada',          en: 'Request rejected',          icon: '❌' },
  CANCELLED:     { es: 'Cancelado',                   en: 'Cancelled',                 icon: '🚫' },
};

const UI: Record<string, { es: string; en: string }> = {
  title:         { es: 'Estado de tu devolución',     en: 'Your return status'         },
  tracking:      { es: 'Número de seguimiento',        en: 'Tracking number'            },
  carrier:       { es: 'Transportista',               en: 'Carrier'                    },
  downloadLabel: { es: 'Descargar etiqueta PDF',       en: 'Download label PDF'         },
  goBack:        { es: '← Volver al portal',          en: '← Back to portal'           },
  notFound:      { es: 'Devolución no encontrada.',   en: 'Return not found.'          },
  loading:       { es: 'Cargando…',                   en: 'Loading…'                   },
  paidOn:        { es: 'Pagado el',                   en: 'Paid on'                    },
  pendingPayment:{ es: 'Pendiente de pago',           en: 'Pending payment'            },
  payNow:        { es: 'Pagar ahora',                 en: 'Pay now'                    },
  copyTracking:  { es: 'Copiado',                     en: 'Copied'                     },
};

export default function EstadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ReturnStatus | null>(null);
  const [error, setError] = useState(false);
  const [lang, setLang] = useState<'es' | 'en'>('es');
  const [copied, setCopied] = useState(false);

  const t = (key: string) => (UI[key] as { es: string; en: string })?.[lang] ?? key;

  useEffect(() => {
    const bl = navigator.language?.slice(0, 2).toLowerCase();
    setLang(bl === 'en' ? 'en' : 'es');
  }, []);

  useEffect(() => {
    if (!id) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/returns/${id}/status`);
        if (!res.ok) { setError(true); return; }
        const json = await res.json() as ReturnStatus;
        setData(json);
      } catch {
        setError(true);
      }
    };

    fetchStatus();

    // Poll if still in early states
    const needsPoll = ['REQUESTED', 'LABEL_CREATED'].includes(data?.status ?? '');
    if (needsPoll) {
      const interval = setInterval(fetchStatus, 8000);
      return () => clearInterval(interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, data?.status]);

  const currentStep = (() => {
    if (!data) return -1;
    if (data.status === 'REFUNDED') return 4;
    return STATUS_ORDER.indexOf(data.status);
  })();

  const isTerminal = ['REJECTED', 'CANCELLED', 'REFUNDED'].includes(data?.status ?? '');
  const isRejected = ['REJECTED', 'CANCELLED'].includes(data?.status ?? '');

  function copyTracking() {
    if (!data?.trackingNumber) return;
    navigator.clipboard.writeText(data.trackingNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: transparent; }
        .page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding: 48px 16px 60px;
          font-family: -apple-system, 'SF Pro Display', BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          position: relative;
        }
        .bg {
          position: fixed; inset: 0;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
          z-index: -2;
        }
        .bg-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: -1;
        }
        .card {
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 24px;
          width: 100%;
          max-width: 440px;
          padding: 28px 24px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.45);
        }
        .timeline-step {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          position: relative;
        }
        .timeline-step:not(:last-child)::after {
          content: '';
          position: absolute;
          left: 18px;
          top: 38px;
          width: 2px;
          height: calc(100% - 10px);
          background: rgba(255,255,255,0.12);
        }
        .timeline-step.done::after { background: rgba(52,199,89,0.4); }
        .timeline-dot {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 16px;
          background: rgba(255,255,255,0.08);
          border: 2px solid rgba(255,255,255,0.15);
          z-index: 1;
          transition: all 0.3s;
        }
        .timeline-dot.done {
          background: rgba(52,199,89,0.2);
          border-color: #34C759;
        }
        .timeline-dot.active {
          background: rgba(0,122,255,0.25);
          border-color: #007AFF;
          box-shadow: 0 0 0 4px rgba(0,122,255,0.15);
        }
        .timeline-dot.rejected {
          background: rgba(255,59,48,0.2);
          border-color: #FF3B30;
        }
        .timeline-label {
          padding-top: 6px;
          padding-bottom: 20px;
        }
        .timeline-title {
          font-size: 15px;
          font-weight: 600;
          color: rgba(255,255,255,0.9);
          line-height: 1.3;
        }
        .timeline-title.inactive { color: rgba(255,255,255,0.35); font-weight: 500; }
        .timeline-title.active { color: #fff; }
        .timeline-title.done { color: rgba(52,199,89,0.9); }
        .timeline-title.rejected { color: #FF3B30; }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(0,122,255,0.15); }
          50% { box-shadow: 0 0 0 8px rgba(0,122,255,0.08); }
        }
        .timeline-dot.active { animation: pulse 2s ease-in-out infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner {
          width: 32px; height: 32px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: rgba(255,255,255,0.7);
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
          margin: 0 auto 16px;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          padding: 10px 14px;
          font-size: 14px;
          color: rgba(255,255,255,0.85);
          cursor: pointer;
          transition: background 0.15s;
          width: 100%;
        }
        .chip:hover { background: rgba(255,255,255,0.12); }
        .download-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 15px 20px;
          background: #007AFF;
          color: #fff;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          text-decoration: none;
          letter-spacing: -0.2px;
          transition: opacity 0.15s;
          margin-top: 8px;
        }
        .download-btn:active { opacity: 0.85; }
        .back-link {
          color: rgba(255,255,255,0.55);
          font-size: 14px;
          text-decoration: none;
          margin-top: 20px;
          display: inline-block;
          transition: color 0.15s;
        }
        .back-link:hover { color: rgba(255,255,255,0.85); }
        .lang-btn {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 16px;
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          cursor: pointer;
          font-family: inherit;
          position: absolute;
          top: 20px;
          right: 20px;
        }
      `}</style>

      <div className="bg" />
      <div className="bg-overlay" />

      <button className="lang-btn" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}>
        {lang === 'es' ? '🇬🇧 EN' : '🇪🇸 ES'}
      </button>

      <div className="page">
        {/* Loading */}
        {!data && !error && (
          <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div className="spinner" />
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>{t('loading')}</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>{t('notFound')}</div>
            <a href="/devoluciones" className="back-link" style={{ marginTop: 20, display: 'inline-block' }}>
              {t('goBack')}
            </a>
          </div>
        )}

        {/* Main content */}
        {data && !error && (
          <div className="card">
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                {t('title')}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>
                #{data.returnId.slice(-8).toUpperCase()}
              </div>
              {data.paidAt && (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                  {t('paidOn')} {new Date(data.paidAt).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              )}
            </div>

            {/* Timeline */}
            <div style={{ marginBottom: 24 }}>
              {isRejected ? (
                <div className="timeline-step">
                  <div className="timeline-dot rejected">❌</div>
                  <div className="timeline-label">
                    <div className="timeline-title rejected">
                      {LABELS[data.status]?.[lang] ?? data.status}
                    </div>
                  </div>
                </div>
              ) : (
                (() => {
                  const steps = data.status === 'REFUNDED'
                    ? [...STATUS_ORDER, 'REFUNDED']
                    : STATUS_ORDER;
                  return steps.map((step, i) => {
                    const isDone = currentStep > i;
                    const isActive = currentStep === i;
                    const dotClass = `timeline-dot${isDone ? ' done' : isActive ? ' active' : ''}`;
                    const titleClass = `timeline-title${isDone ? ' done' : isActive ? ' active' : ' inactive'}`;
                    const isLast = i === steps.length - 1;
                    return (
                      <div key={step} className={`timeline-step${isDone ? ' done' : ''}`}
                        style={isLast ? { '--after-display': 'none' } as React.CSSProperties : {}}>
                        <div className={dotClass}>
                          {isDone ? '✓' : LABELS[step]?.icon ?? '○'}
                        </div>
                        <div className="timeline-label">
                          <div className={titleClass}>
                            {LABELS[step]?.[lang] ?? step}
                          </div>
                          {isActive && !isTerminal && (
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                              {lang === 'es' ? 'En proceso…' : 'In progress…'}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Pending payment */}
              {data.paymentStatus === 'PENDING' && data.checkoutUrl && (
                <a
                  href={data.checkoutUrl}
                  className="download-btn"
                  style={{ background: '#FF9500' }}
                >
                  💳 {t('payNow')} {data.totalAmount != null ? `· ${data.totalAmount.toFixed(2)}€` : ''}
                </a>
              )}

              {/* Tracking number */}
              {data.trackingNumber && (
                <div className="chip" onClick={copyTracking}>
                  <span style={{ fontSize: 18 }}>📍</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                      {t('tracking')}{data.carrier ? ` · ${data.carrier}` : ''}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.5 }}>
                      {data.trackingNumber}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    {copied ? '✓ ' + t('copyTracking') : '⎘'}
                  </span>
                </div>
              )}

              {/* Label download */}
              {data.labelUrl && (
                <a
                  href={data.labelUrl.startsWith('http') ? data.labelUrl : `${API_URL}${data.labelUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="download-btn"
                >
                  ⬇ {t('downloadLabel')}
                </a>
              )}
            </div>
          </div>
        )}

        <a href="/devoluciones" className="back-link">{t('goBack')}</a>
      </div>
    </>
  );
}
