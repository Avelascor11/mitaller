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

type Lang = 'es' | 'en';
const STR = {
  es: {
    kicker: 'SPEEDWEAR CREW 🏁🔥',
    title: 'Nos hace ilusión tenerte en el crew',
    intro1: 'Para prepararte tu pack personalizado, déjanos tus datos. Te toma 1 minuto ⚡',
    intro2: 'En cuanto lo tengamos, preparamos el envío y te avisamos cuando salga 🚚',
    ig: 'Tu Instagram', fullName: 'Nombre completo', email: 'Email', phone: 'Teléfono',
    address1: 'Dirección (calle, número, piso)', postal: 'Código postal', city: 'Ciudad', province: 'Provincia',
    followers: 'Nº de seguidores en Instagram', content: 'Enlace a tu mejor contenido (opcional)',
    contentPh: 'Link a un reel/foto tuya — si puedes, mucho mejor 🔥',
    code: 'Tu código de descuento de referido', codePh: 'Ej. JULIA10 — el que darás a tus seguidores',
    codeHint: '3–20 letras/números. Será tu código y tu enlace de referido.',
    waitlist: 'Aún no llegas a 1.000 seguidores — entra en lista de espera 👇',
    levelYou: 'Nivel', levelCan: '· puedes elegir',
    garments: 'Prendas', accessories: 'Accesorios', accNote: '¡Tu nivel incluye accesorio! Elige uno 👇',
    rights: 'Autorizo a Speedwear a usar mi contenido (reels, stories, fotos) en sus anuncios y redes.',
    join: 'Unirme a la Crew', joinWait: 'Entrar en lista de espera', sending: 'Enviando…',
    loading: 'Cargando catálogo…', noProducts: 'Sin productos disponibles.', choose: 'Elegir', chosen: '✓ Elegido',
    pickSize: 'Elige una talla primero.', tooMany: (l: string) => `Tu nivel permite ${l}.`,
    doneWaitTitle: 'En lista de espera', doneTitle: '¡Bienvenido a la Crew!', willCreate: 'Se creará',
    doneMsg: '¡Solicitud recibida! Preparamos tu pack y te avisamos cuando salga el envío 🚚',
    doneWaitMsg: 'Te has unido a la lista de espera. Te avisamos cuando crezcas un poco más.',
    tierLabels: { ELITE: '2 prendas + 1 accesorio', PRO: '2 prendas', PLUS: '1 prenda + 1 accesorio', BASE: '1 prenda', WAITLIST: 'Lista de espera' } as Record<string, string>
  },
  en: {
    kicker: 'SPEEDWEAR CREW 🏁🔥',
    title: 'We’d love you in the crew',
    intro1: 'To prep your personalized pack, leave us your details. Takes 1 minute ⚡',
    intro2: 'Once we have it, we’ll prepare your shipment and let you know when it’s out 🚚',
    ig: 'Your Instagram', fullName: 'Full name', email: 'Email', phone: 'Phone',
    address1: 'Address (street, number, floor)', postal: 'Postal code', city: 'City', province: 'Province / State',
    followers: 'Instagram followers', content: 'Link to your best content (optional)',
    contentPh: 'Link to a reel/photo of yours — even better if you can 🔥',
    code: 'Your referral discount code', codePh: 'e.g. JULIA10 — the one you’ll give your followers',
    codeHint: '3–20 letters/numbers. This will be your code and referral link.',
    waitlist: 'You’re not at 1,000 followers yet — join the waitlist 👇',
    levelYou: 'Level', levelCan: '· you can choose',
    garments: 'Garments', accessories: 'Accessories', accNote: 'Your level includes an accessory! Pick one 👇',
    rights: 'I authorize Speedwear to use my content (reels, stories, photos) in its ads and socials.',
    join: 'Join the Crew', joinWait: 'Join the waitlist', sending: 'Sending…',
    loading: 'Loading catalog…', noProducts: 'No products available.', choose: 'Choose', chosen: '✓ Chosen',
    pickSize: 'Pick a size first.', tooMany: (l: string) => `Your level allows ${l}.`,
    doneWaitTitle: 'On the waitlist', doneTitle: 'Welcome to the Crew!', willCreate: 'Will create',
    doneMsg: 'Request received! We’re prepping your pack and will let you know when it ships 🚚',
    doneWaitMsg: 'You’ve joined the waitlist. We’ll reach out when you grow a bit more.',
    tierLabels: { ELITE: '2 garments + 1 accessory', PRO: '2 garments', PLUS: '1 garment + 1 accessory', BASE: '1 garment', WAITLIST: 'Waitlist' } as Record<string, string>
  }
} as const;

export default function CrewPage() {
  const [lang, setLang] = useState<Lang>('es');
  const t = STR[lang];
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')) setLang('en');
  }, []);
  const tierLabel = (tk: string) => t.tierLabels[tk] ?? tk;

  const [catalog, setCatalog] = useState<Catalog>({ prendas: [], accesorios: [] });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [followers, setFollowers] = useState('');
  const [phone, setPhone] = useState('');
  const [address1, setAddress1] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [contentUrl, setContentUrl] = useState('');
  const [desiredCode, setDesiredCode] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [sizeSel, setSizeSel] = useState<Record<string, string>>({});
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

  function togglePick(p: Product) {
    setError(null);
    const exists = picks.find(x => x.productId === p.id);
    if (exists) { setPicks(picks.filter(x => x.productId !== p.id)); return; }
    if (!tier) return;
    const limit = p.category === 'PRENDA' ? tier.garments : tier.accessories;
    const current = p.category === 'PRENDA' ? garmentsPicked : accessoriesPicked;
    if (current >= limit) { setError(t.tooMany(tierLabel(tier.tier))); return; }
    const size = sizeSel[p.id];
    if (p.sizes.length && !size) { setError(t.pickSize); return; }
    const variant = resolveVariant(p, size);
    setPicks([...picks, { productId: p.id, title: p.title, variantId: variant?.id, sku: variant?.sku, size, category: p.category, imageUrl: p.imageUrl ?? undefined }]);
  }

  function setPickSize(productId: string, size: string) {
    setError(null);
    setSizeSel({ ...sizeSel, [productId]: size });
    const prod = [...catalog.prendas, ...catalog.accesorios].find(p => p.id === productId);
    const variant = prod ? resolveVariant(prod, size) : undefined;
    setPicks(picks.map(x => x.productId === productId ? { ...x, size, variantId: variant?.id ?? x.variantId, sku: variant?.sku ?? x.sku } : x));
  }

  const canSubmit = !!tier && tier.tier !== 'WAITLIST' && handle.trim() && name.trim() && email.trim() && phone.trim()
    && address1.trim() && postalCode.trim() && city.trim() && province.trim()
    && garmentsPicked >= Math.min(1, tier.garments) && rights && !submitting;

  async function submit() {
    if (!tier) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/crew/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          igHandle: handle, email, fullName: name, followers: Number(followers),
          phone, address1, postalCode, city, province,
          shippingAddress: `${address1}, ${postalCode} ${city} (${province})`,
          contentUrl, desiredCode,
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
          {done.status === 'WAITLIST' ? t.doneWaitTitle : t.doneTitle}
        </h1>
        <p style={{ color: C.muted, maxWidth: 420 }}>{done.status === 'WAITLIST' ? t.doneWaitMsg : t.doneMsg}</p>
        {done.status !== 'WAITLIST' && (
          <p style={{ color: C.accent, marginTop: 16, fontWeight: 700 }}>{t.levelYou} {done.tier.tier} · {tierLabel(done.tier.tier)}</p>
        )}
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 8 }}>
          {(['es', 'en'] as Lang[]).map(l => (
            <button key={l} onClick={() => setLang(l)} style={{
              border: `1px solid ${lang === l ? C.accent : C.line}`, background: lang === l ? C.accent : 'transparent',
              color: lang === l ? '#0B0B0F' : C.muted, borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer'
            }}>{l.toUpperCase()}</button>
          ))}
        </div>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: C.accent, fontWeight: 800, letterSpacing: 2, fontSize: 13 }}>{t.kicker}</div>
          <h1 style={{ color: C.ink, fontSize: 32, fontWeight: 900, margin: '8px 0' }}>{t.title}</h1>
          <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.5 }}>{t.intro1}<br />{t.intro2}</p>
        </header>

        {/* Datos */}
        <section style={card}>
          <Label>{t.ig}</Label>
          <Input value={handle} onChange={setHandle} placeholder="@usuario" />
          <Label>{t.fullName}</Label>
          <Input value={name} onChange={setName} placeholder={t.fullName} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><Label>{t.email}</Label><Input value={email} onChange={setEmail} placeholder="tu@email.com" /></div>
            <div><Label>{t.phone}</Label><Input value={phone} onChange={setPhone} placeholder="600 000 000" /></div>
          </div>
          <Label>{t.address1}</Label>
          <Input value={address1} onChange={setAddress1} placeholder="Calle Ejemplo 4, 2ºB" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
            <div><Label>{t.postal}</Label><Input value={postalCode} onChange={setPostalCode} placeholder="45530" /></div>
            <div><Label>{t.city}</Label><Input value={city} onChange={setCity} placeholder="Santa Olalla" /></div>
          </div>
          <Label>{t.province}</Label>
          <Input value={province} onChange={setProvince} placeholder="Toledo" />
          <Label>{t.followers}</Label>
          <Input value={followers} onChange={setFollowers} placeholder="8500" type="number" />
          <Label>{t.content}</Label>
          <Input value={contentUrl} onChange={setContentUrl} placeholder={t.contentPh} />
          <Label>{t.code}</Label>
          <Input value={desiredCode} onChange={(v) => setDesiredCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder={t.codePh} />
          <div style={{ color: C.muted, fontSize: 11, margin: '2px 2px 0' }}>{t.codeHint}</div>
        </section>

        {/* Tier */}
        {tier && (
          <div style={{ ...tierBanner, borderColor: tier.tier === 'WAITLIST' ? C.amber : C.accent }}>
            {tier.tier === 'WAITLIST'
              ? <span style={{ color: C.amber }}>{t.waitlist}</span>
              : <span style={{ color: C.ink }}>{t.levelYou} <b style={{ color: C.accent }}>{tier.tier}</b> {t.levelCan} <b>{tierLabel(tier.tier)}</b></span>}
          </div>
        )}

        {/* Catálogo */}
        {tier && tier.tier !== 'WAITLIST' && (
          <>
            <Section title={`${t.garments} (${garmentsPicked}/${tier.garments})`} />
            <Grid products={catalog.prendas} picks={picks} sizeSel={sizeSel} onToggle={togglePick} onSize={setPickSize} loading={loadingCatalog} t={t} />
            {tier.accessories > 0 && garmentsPicked > 0 && (
              <>
                <Section title={`${t.accessories} (${accessoriesPicked}/${tier.accessories})`} />
                <div style={{ color: C.accent, fontSize: 12, fontWeight: 700, margin: '0 2px 8px' }}>{t.accNote}</div>
                <Grid products={catalog.accesorios} picks={picks} sizeSel={sizeSel} onToggle={togglePick} onSize={setPickSize} loading={loadingCatalog} t={t} />
              </>
            )}
          </>
        )}

        {/* Derechos */}
        {tier && tier.tier !== 'WAITLIST' && (
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: C.muted, fontSize: 13, margin: '18px 2px' }}>
            <input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{t.rights}</span>
          </label>
        )}

        {error && <div style={{ color: C.danger, fontSize: 14, margin: '8px 2px', fontWeight: 600 }}>{error}</div>}

        {/* Spacer so content isn't hidden behind the sticky bar */}
        <div style={{ height: 96 }} />
      </div>

      {/* Sticky submit bar — always visible */}
      <div style={stickyBar}>
        <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
          <button onClick={submit} disabled={tier?.tier === 'WAITLIST' ? submitting : !canSubmit}
            style={{ ...btn, marginTop: 0, background: tier?.tier === 'WAITLIST' ? C.amber : C.accent, opacity: (tier?.tier === 'WAITLIST' ? !submitting : canSubmit) ? 1 : 0.4 }}>
            {submitting ? t.sending : tier?.tier === 'WAITLIST' ? t.joinWait : t.join}
          </button>
        </div>
      </div>
    </main>
  );
}

function Grid({ products, picks, sizeSel, onToggle, onSize, loading, t }: {
  products: Product[]; picks: Pick[]; sizeSel: Record<string, string>; onToggle: (p: Product) => void; onSize: (id: string, s: string) => void; loading: boolean; t: { loading: string; noProducts: string; choose: string; chosen: string };
}) {
  if (loading) return <p style={{ color: C.muted }}>{t.loading}</p>;
  if (!products.length) return <p style={{ color: C.muted, fontSize: 13 }}>{t.noProducts}</p>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
      {products.map(p => {
        const pick = picks.find(x => x.productId === p.id);
        const selected = !!pick;
        const chosenSize = pick?.size ?? sizeSel[p.id];
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
                    ...sizeBtn, borderColor: chosenSize === s ? C.accent : C.line, color: chosenSize === s ? C.accent : C.muted
                  }}>{s}</button>
                ))}
              </div>
            )}
            <button onClick={() => onToggle(p)}
              style={{ ...pickBtn, background: selected ? C.accent : 'transparent', color: selected ? '#0B0B0F' : C.ink, borderColor: selected ? C.accent : C.line }}>
              {selected ? t.chosen : t.choose}
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
const stickyBar: React.CSSProperties = { position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', background: 'rgba(11,11,15,0.92)', backdropFilter: 'blur(10px)', borderTop: `1px solid ${C.line}`, zIndex: 50 };
