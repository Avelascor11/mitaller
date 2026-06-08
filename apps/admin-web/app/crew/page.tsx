'use client';

import { useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Variant = { id: string; title: string; sku: string; available: boolean };
type Product = {
  id: string;
  title: string;
  imageUrl: string | null;
  category: 'PRENDA' | 'ACCESORIO';
  sizes: string[];
  variants: Variant[];
};
type Catalog = { prendas: Product[]; accesorios: Product[] };
type Tier = { tier: string; label: string; garments: number; accessories: number; minFollowers: number };
type Pick = { productId: string; title: string; variantId?: string; sku?: string; size?: string; category: 'PRENDA' | 'ACCESORIO'; imageUrl?: string };

function resolveVariant(p: Product, size?: string): Variant | undefined {
  if (p.variants?.length === 1) return p.variants[0];
  if (!size) return undefined;
  const up = size.toUpperCase();
  return p.variants?.find(v => v.title.toUpperCase().split(/[\/|,-]/).map(s => s.trim()).includes(up));
}

const C = {
  bg: '#0B0B0F', card: '#15151C', line: '#26262F', ink: '#FFFFFF', muted: '#9A9AA8',
  accent: '#51DE9A', accent2: '#736BF7', danger: '#FB6877', amber: '#FBBF49'
};

export default function CrewPage() {
  const [catalog, setCatalog] = useState<Catalog>({ prendas: [], accesorios: [] });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [followers, setFollowers] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [contentUrl, setContentUrl] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [rights, setRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ tier: Tier; message: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/crew/catalog`).then(r => r.json()).then(setCatalog).catch(() => {}).finally(() => setLoadingCatalog(false));
  }, []);

  const tier: Tier | null = useMemo(() => {
    const f = Number(followers);
    if (!Number.isFinite(f) || f <= 0) return null;
    if (f >= 15000) return { tier: 'ELITE', label: '2 prendas + 1 accesorio', garments: 2, accessories: 1, minFollowers: 15000 };
    if (f >= 10000) return { tier: 'PRO', label: '2 prendas', garments: 2, accessories: 0, minFollowers: 10000 };
    if (f >= 5000) return { tier: 'PLUS', label: '1 prenda + 1 accesorio', garments: 1, accessories: 1, minFollowers: 5000 };
    if (f >= 1000) return { tier: 'BASE', label: '1 prenda', garments: 1, accessories: 0, minFollowers: 1000 };
    return { tier: 'WAITLIST', label: 'Lista de espera', garments: 0, accessories: 0, minFollowers: 0 };
  }, [followers]);

  const garmentsPicked = picks.filter(p => p.category === 'PRENDA').length;
  const accessoriesPicked = picks.filter(p => p.category === 'ACCESORIO').length;

  function togglePick(p: Product, size?: string) {
    setError(null);
    const exists = picks.find(x => x.productId === p.id);
    if (exists) { setPicks(picks.filter(x => x.productId !== p.id)); return; }
    if (!tier) return;
    const limit = p.category === 'PRENDA' ? tier.garments : tier.accessories;
    const current = p.category === 'PRENDA' ? garmentsPicked : accessoriesPicked;
    if (current >= limit) { setError(`Tu nivel permite ${tier.label}.`); return; }
    if (p.sizes.length && !size) { setError('Elige una talla primero.'); return; }
    const variant = resolveVariant(p, size);
    setPicks([...picks, { productId: p.id, title: p.title, variantId: variant?.id, sku: variant?.sku, size, category: p.category, imageUrl: p.imageUrl ?? undefined }]);
  }

  function setPickSize(productId: string, size: string) {
    const prod = [...catalog.prendas, ...catalog.accesorios].find(p => p.id === productId);
    const variant = prod ? resolveVariant(prod, size) : undefined;
    setPicks(picks.map(x => x.productId === productId ? { ...x, size, variantId: variant?.id ?? x.variantId, sku: variant?.sku ?? x.sku } : x));
  }

  const canSubmit = !!tier && tier.tier !== 'WAITLIST' && handle.trim() && name.trim() && email.trim() && phone.trim() && address.trim()
    && garmentsPicked >= Math.min(1, tier.garments) && rights && !submitting;

  async function submit() {
    if (!tier) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/crew/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          igHandle: handle, email, fullName: name, followers: Number(followers),
          phone, shippingAddress: address, contentUrl,
          products: picks, acceptedRights: rights
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al enviar');
      setDone({ tier, message: data.message, status: data.status });
    } catch (e: any) {
      setError(e.message || 'Error al enviar');
    } finally { setSubmitting(false); }
  }

  if (done) {
    return (
      <main style={{ ...wrap, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 56 }}>{done.status === 'WAITLIST' ? '⏳' : '🎉'}</div>
        <h1 style={{ color: C.ink, fontSize: 28, margin: '12px 0' }}>
          {done.status === 'WAITLIST' ? 'En lista de espera' : '¡Bienvenido a la Crew!'}
        </h1>
        <p style={{ color: C.muted, maxWidth: 420 }}>{done.message}</p>
        {done.status !== 'WAITLIST' && (
          <p style={{ color: C.accent, marginTop: 16, fontWeight: 700 }}>Nivel {done.tier.tier} · {done.tier.label}</p>
        )}
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: C.accent, fontWeight: 800, letterSpacing: 2, fontSize: 13 }}>SPEEDWEAR CREW 🏁🔥</div>
          <h1 style={{ color: C.ink, fontSize: 32, fontWeight: 900, margin: '8px 0' }}>Nos hace ilusión tenerte en el crew</h1>
          <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.5 }}>
            Para prepararte tu <b style={{ color: C.ink }}>pack personalizado</b>, déjanos tus datos. Te toma 1 minuto ⚡<br />
            En cuanto lo tengamos, preparamos el envío y te avisamos cuando salga 🚚
          </p>
        </header>

        {/* Datos */}
        <section style={card}>
          <Label>Tu Instagram</Label>
          <Input value={handle} onChange={setHandle} placeholder="@tuusuario" />
          <Label>Nombre completo</Label>
          <Input value={name} onChange={setName} placeholder="Nombre y apellidos" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><Label>Email</Label><Input value={email} onChange={setEmail} placeholder="tu@email.com" /></div>
            <div><Label>Teléfono</Label><Input value={phone} onChange={setPhone} placeholder="600 000 000" /></div>
          </div>
          <Label>Dirección de envío</Label>
          <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Calle, número, piso, CP, ciudad, provincia"
            style={{ ...inp, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} />
          <Label>Nº de seguidores en Instagram</Label>
          <Input value={followers} onChange={setFollowers} placeholder="ej. 8500" type="number" />
          <Label>Enlace a tu mejor contenido (opcional)</Label>
          <Input value={contentUrl} onChange={setContentUrl} placeholder="Link a un reel/foto tuya — si puedes, mucho mejor 🔥" />
        </section>

        {/* Tier */}
        {tier && (
          <div style={{ ...tierBanner, borderColor: tier.tier === 'WAITLIST' ? C.amber : C.accent }}>
            {tier.tier === 'WAITLIST'
              ? <span style={{ color: C.amber }}>Aún no llegas a 1.000 seguidores — entra en lista de espera 👇</span>
              : <span style={{ color: C.ink }}>Nivel <b style={{ color: C.accent }}>{tier.tier}</b> · puedes elegir <b>{tier.label}</b></span>}
          </div>
        )}

        {/* Catálogo */}
        {tier && tier.tier !== 'WAITLIST' && (
          <>
            <Section title={`Prendas (${garmentsPicked}/${tier.garments})`} />
            <Grid products={catalog.prendas} picks={picks} onToggle={togglePick} onSize={setPickSize} loading={loadingCatalog} />
            {tier.accessories > 0 && (
              <>
                <Section title={`Accesorios (${accessoriesPicked}/${tier.accessories})`} />
                <Grid products={catalog.accesorios} picks={picks} onToggle={togglePick} onSize={setPickSize} loading={loadingCatalog} />
              </>
            )}
          </>
        )}

        {/* Derechos */}
        {tier && tier.tier !== 'WAITLIST' && (
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: C.muted, fontSize: 13, margin: '18px 2px' }}>
            <input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Autorizo a Speedwear a usar mi contenido (reels, stories, fotos) en sus anuncios y redes.</span>
          </label>
        )}

        {error && <div style={{ color: C.danger, fontSize: 14, margin: '8px 2px', fontWeight: 600 }}>{error}</div>}

        <button onClick={submit} disabled={!canSubmit} style={{ ...btn, opacity: canSubmit ? 1 : 0.4 }}>
          {submitting ? 'Enviando…' : tier?.tier === 'WAITLIST' ? 'Apuntarme a la lista' : 'Unirme a la Crew'}
        </button>
        {tier?.tier === 'WAITLIST' && (
          <button onClick={submit} disabled={submitting} style={{ ...btn, background: C.amber, marginTop: 8 }}>
            {submitting ? 'Enviando…' : 'Entrar en lista de espera'}
          </button>
        )}
        <div style={{ height: 40 }} />
      </div>
    </main>
  );
}

function Grid({ products, picks, onToggle, onSize, loading }: {
  products: Product[]; picks: Pick[]; onToggle: (p: Product, size?: string) => void; onSize: (id: string, s: string) => void; loading: boolean;
}) {
  if (loading) return <p style={{ color: C.muted }}>Cargando catálogo…</p>;
  if (!products.length) return <p style={{ color: C.muted, fontSize: 13 }}>Sin productos disponibles.</p>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
      {products.map(p => {
        const pick = picks.find(x => x.productId === p.id);
        const selected = !!pick;
        return (
          <div key={p.id} style={{ ...prodCard, borderColor: selected ? C.accent : C.line }}>
            <div style={{ width: '100%', aspectRatio: '1', background: '#0E0E13', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
              {p.imageUrl && <img src={p.imageUrl} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <div style={{ color: C.ink, fontSize: 13, fontWeight: 700, lineHeight: 1.2, minHeight: 32 }}>{p.title}</div>
            {p.sizes.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0' }}>
                {p.sizes.map(s => (
                  <button key={s} onClick={() => onSize(p.id, s)} style={{
                    ...sizeBtn, borderColor: pick?.size === s ? C.accent : C.line, color: pick?.size === s ? C.accent : C.muted
                  }}>{s}</button>
                ))}
              </div>
            )}
            <button onClick={() => onToggle(p, pick?.size ?? (p.sizes[0] && pick ? pick.size : undefined))}
              style={{ ...pickBtn, background: selected ? C.accent : 'transparent', color: selected ? '#0B0B0F' : C.ink, borderColor: selected ? C.accent : C.line }}>
              {selected ? '✓ Elegido' : 'Elegir'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div style={{ color: C.muted, fontSize: 12, fontWeight: 700, margin: '10px 2px 4px' }}>{children}</div>;
const Input = ({ value, onChange, placeholder, type }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) =>
  <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type ?? 'text'} style={inp} />;
const Section = ({ title }: { title: string }) => <h2 style={{ color: C.ink, fontSize: 16, fontWeight: 800, margin: '22px 2px 10px' }}>{title}</h2>;

const wrap: React.CSSProperties = { minHeight: '100vh', background: C.bg, padding: '32px 16px', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif' };
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 };
const inp: React.CSSProperties = { width: '100%', background: '#0E0E13', border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 12px', color: C.ink, fontSize: 15, outline: 'none', boxSizing: 'border-box' };
const tierBanner: React.CSSProperties = { border: '1px solid', borderRadius: 12, padding: '12px 14px', margin: '14px 0', fontSize: 14, background: '#15151C' };
const prodCard: React.CSSProperties = { background: C.card, border: '1px solid', borderRadius: 14, padding: 10 };
const sizeBtn: React.CSSProperties = { border: '1px solid', background: 'transparent', borderRadius: 8, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
const pickBtn: React.CSSProperties = { width: '100%', border: '1px solid', borderRadius: 10, padding: '8px', fontSize: 13, fontWeight: 800, cursor: 'pointer', marginTop: 6 };
const btn: React.CSSProperties = { width: '100%', background: C.accent, color: '#0B0B0F', border: 'none', borderRadius: 14, padding: '15px', fontSize: 16, fontWeight: 900, cursor: 'pointer', marginTop: 18 };
