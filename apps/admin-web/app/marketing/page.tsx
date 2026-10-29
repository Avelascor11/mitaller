'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, BarChart3, ClipboardCheck, Copy, FileText, Filter, FormInput, Mail, Megaphone, Pause, Play, Plus,
  RefreshCw, Send, Settings, Trash2, Upload, Users, Workflow, X
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Block = { type: 'heading' | 'text' | 'button' | 'image' | 'divider'; text?: string; url?: string };
type Content = { name: string; subject: string; preheader: string; blocks: Block[] };
type Condition = { field: string; operator: string; value?: string; days?: number };
type Rules = { mode: 'all' | 'any'; conditions: Condition[] };
type Contact = { id: string; email: string; firstName: string; lastName: string; country: string; tags: string[]; status: string; consentAt: string | null; consentSource: string | null; createdAt: string };
type Stats = { sent: number; opened: number; clicked: number; bounced: number; unsubscribed: number; revenue: number; orders: number };
type Segment = { id: string; name: string; rules: Rules; count: number };
type Template = Content & { id: string; updatedAt: string };
type Campaign = Content & { id: string; segmentId: string | null; status: string; scheduledAt: string | null; createdAt: string; stats?: Stats };
type Step = { delayMinutes: number; templateId: string };
type Flow = { id: string; name: string; trigger: string; stopOnEvent: string | null; transactional: boolean; reentryDays: number; status: string; steps: Step[]; stats?: Stats; queued?: number };
type Form = { id: string; name: string; headline: string; description: string; buttonText: string; tag: string; active: boolean };
type Settings = { ready: boolean; checks: { key: string; ready: boolean }[]; fromEmail: string; fromName: string; address: string; publicApiUrl: string; integrationConfigured: boolean; captureEvents: boolean; shopifyWebhooks: boolean; klaviyoImport: boolean; attributionDays: number; batchSize: number };
type EventInfo = { name: string; count: number; lastAt: string; keys: string[] };
type Tab = 'resumen' | 'contactos' | 'segmentos' | 'plantillas' | 'campanas' | 'automatizaciones' | 'formularios' | 'ajustes';

const TABS: [Tab, string, typeof Mail][] = [
  ['resumen', 'Resumen', BarChart3], ['contactos', 'Contactos', Users], ['segmentos', 'Segmentos', Filter], ['plantillas', 'Plantillas', FileText],
  ['campanas', 'Campañas', Megaphone], ['automatizaciones', 'Automatizaciones', Workflow], ['formularios', 'Formularios', FormInput], ['ajustes', 'Ajustes', Settings]
];
const STATUS: Record<string, [string, string]> = {
  PENDING: ['Pendiente', 'warn'], SUBSCRIBED: ['Suscrito', 'ok'], UNSUBSCRIBED: ['Baja', 'muted'], BOUNCED: ['Rebotado', 'bad'], COMPLAINED: ['Spam', 'bad'],
  DRAFT: ['Borrador', 'muted'], SCHEDULED: ['Programada', 'info'], FINISHED: ['Enviada', 'ok'], CANCELLED: ['Cancelada', 'muted'], LIVE: ['Activa', 'ok'],
  QUEUED: ['En cola', 'info'], SENDING: ['Enviando', 'info'], SENT: ['Enviado', 'ok'], DELIVERED: ['Entregado', 'ok'], FAILED: ['Fallido', 'bad'], UNKNOWN: ['Revisar', 'warn'], SKIPPED: ['Omitido', 'muted']
};
const FIELDS: [string, string][] = [['tag', 'Etiqueta'], ['country', 'País'], ['email', 'Email'], ['event', 'Ha hecho el evento'], ['opened', 'Abrió un email'], ['clicked', 'Hizo clic'], ['created', 'Alta del contacto']];
const KNOWN_EVENTS = ['Subscribed', 'Started Checkout', 'Placed Order', 'Fulfilled Order', 'Viewed Product', 'Return Label Created', 'Return Received', 'Return Approved', 'Return Label Failed', 'Carrier Return', 'Crew Welcome'];
const FLOW_PRESETS: { label: string; trigger: string; stopOnEvent: string; transactional?: boolean; reentryDays: number; delays: number[] }[] = [
  { label: 'Bienvenida', trigger: 'Subscribed', stopOnEvent: '', reentryDays: 0, delays: [0, 2 * 1440, 3 * 1440] },
  { label: 'Carrito abandonado', trigger: 'Started Checkout', stopOnEvent: 'Placed Order', reentryDays: 5, delays: [120, 22 * 60, 48 * 60] },
  { label: 'Navegación abandonada', trigger: 'Viewed Product', stopOnEvent: 'Started Checkout', reentryDays: 7, delays: [240] },
  { label: 'Post-compra', trigger: 'Fulfilled Order', stopOnEvent: '', reentryDays: 0, delays: [7 * 1440] },
  { label: 'Recuperación de clientes', trigger: 'Placed Order', stopOnEvent: 'Placed Order', reentryDays: 0, delays: [60 * 1440, 30 * 1440] },
  { label: 'Aviso de devolución', trigger: 'Return Label Created', stopOnEvent: '', transactional: true, reentryDays: 0, delays: [0] }
];
const blankContent = (): Content => ({ name: '', subject: '', preheader: '', blocks: [{ type: 'heading', text: 'Hola {{firstName}}' }, { type: 'text', text: '' }, { type: 'button', text: 'Ver en speedwear.es', url: 'https://speedwear.es' }] });

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = typeof window === 'undefined' ? '' : localStorage.getItem('token') ?? '';
  const res = await fetch(`${API}/marketing${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Sesión caducada'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message ?? `Error ${res.status}`);
  return data as T;
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const eur = (v: number) => v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const date = (v?: string | null) => (v ? new Date(v).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const delayLabel = (m: number) => (m === 0 ? 'Inmediato' : m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);

function Badge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status, 'muted'];
  return <span className={`mkBadge ${tone}`}>{label}</span>;
}
function StatRow({ stats }: { stats?: Stats }) {
  if (!stats) return null;
  return <span className="mkStatRow"><b>{stats.sent}</b> env · {pct(stats.opened, stats.sent)} abre · {pct(stats.clicked, stats.sent)} clic · {eur(stats.revenue)}</span>;
}

function useToast() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ok = useCallback((msg: string, good = true) => { setToast({ msg, ok: good }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 4500); }, []);
  const err = useCallback((e: unknown) => ok(e instanceof Error ? e.message : String(e), false), [ok]);
  return useMemo(() => ({ toast, ok, err }), [toast, ok, err]);
}
type Notify = ReturnType<typeof useToast>;

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('resumen');
  const [standalone, setStandalone] = useState(false);
  const notify = useToast();
  // On marketing.speedwear.es only this portal is served, so links to the rest of Mitaller would loop back here.
  useEffect(() => { setStandalone(window.location.hostname.startsWith('marketing.')); }, []);
  useEffect(() => {
    const read = () => { const t = window.location.hash.slice(1) as Tab; if (TABS.some(([k]) => k === t)) setTab(t); };
    read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read);
  }, []);
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="logo">M</span><span>Speedwear Mail</span></div>
        <nav>
          <div className="navLabel">Email marketing</div>
          {TABS.map(([key, label, Icon]) => <a key={key} href={`#${key}`} className={tab === key ? 'active' : ''}><Icon size={17} /><span>{label}</span></a>)}
          {!standalone && <>
            <div className="navLabel">Mitaller</div>
            <a href="/"><ClipboardCheck size={17} /><span>Dashboard</span></a>
            <a href="/campanas"><Megaphone size={17} /><span>Rebajas y Shopify</span></a>
          </>}
        </nav>
      </aside>
      <section className="content mkContent">
        {tab === 'resumen' && <Overview notify={notify} />}
        {tab === 'contactos' && <Contacts notify={notify} />}
        {tab === 'segmentos' && <Segments notify={notify} />}
        {tab === 'plantillas' && <Templates notify={notify} />}
        {tab === 'campanas' && <Campaigns notify={notify} />}
        {tab === 'automatizaciones' && <Flows notify={notify} />}
        {tab === 'formularios' && <Forms notify={notify} />}
        {tab === 'ajustes' && <SettingsTab notify={notify} />}
      </section>
      {notify.toast && <div className={`mkToast ${notify.toast.ok ? '' : 'bad'}`}>{notify.toast.msg}</div>}
    </main>
  );
}

function Header({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <header className="topbar"><div className="title"><h1>{title}</h1><p>{subtitle}</p></div><div className="actions">{children}</div></header>;
}
function useLoad<T>(load: () => Promise<T>, notify: Notify) {
  const [data, setData] = useState<T | null>(null);
  const reload = useCallback(() => load().then(setData).catch(notify.err), [load, notify.err]);
  useEffect(() => { void reload(); }, [reload]);
  return [data, reload] as const;
}

// ── Resumen ──
function Overview({ notify }: { notify: Notify }) {
  const load = useCallback(() => api('/overview'), []);
  const [data, reload] = useLoad<any>(load, notify);
  if (!data) return <Header title="Resumen" subtitle="Cargando…" />;
  const sent = Object.entries(data.statuses as Record<string, number>).filter(([s]) => ['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED'].includes(s)).reduce((a, [, n]) => a + n, 0);
  const max = Math.max(1, ...data.daily.map((d: any) => d.count));
  return (
    <>
      <Header title="Resumen" subtitle="Últimos 30 días de email marketing."><button onClick={reload}><RefreshCw size={14} /></button></Header>
      {!data.settings.ready && <div className="mkNotice warn">Envíos desactivados: faltan ajustes SMTP o <code>MARKETING_SEND_ENABLED=true</code>. Revisa <a href="#ajustes">Ajustes</a>.</div>}
      <div className="mkKpis">
        <Kpi label="Suscritos" value={data.subscribed.toLocaleString('es-ES')} hint={`${data.contacts.toLocaleString('es-ES')} contactos`} />
        <Kpi label="Emails enviados" value={sent.toLocaleString('es-ES')} hint={`${data.activeFlows} automatizaciones activas`} />
        <Kpi label="Apertura" value={pct(data.opened, sent)} hint={`${data.opened} aperturas`} />
        <Kpi label="Clics" value={pct(data.clicked, sent)} hint={`${data.clicked} clics`} />
        <Kpi label="Ingresos atribuidos" value={eur(data.revenue.attributed)} hint={`${data.revenue.attributedOrders} pedidos · ${pct(data.revenue.attributed, data.revenue.total)} de ${eur(data.revenue.total)}`} />
      </div>
      <div className="mkGrid2">
        <section className="panel">
          <h2>Envíos por día</h2>
          <div className="mkBars">{data.daily.length ? data.daily.map((d: any) => <div key={d.day} title={`${d.day}: ${d.count}`} style={{ height: `${(d.count / max) * 100}%` }} />) : <p className="mkMuted">Sin envíos todavía.</p>}</div>
        </section>
        <section className="panel">
          <h2>Campañas recientes</h2>
          <div className="mkList">{data.recentCampaigns.map((c: Campaign & { _count: { messages: number } }) => <div key={c.id}><span>{c.name}</span><Badge status={c.status} /><small>{c._count.messages} destinatarios</small></div>)}{!data.recentCampaigns.length && <p className="mkMuted">Aún no hay campañas.</p>}</div>
        </section>
      </div>
      {data.failures.length > 0 && (
        <section className="panel">
          <h2>Envíos a revisar</h2>
          <p className="mkMuted">«Revisar» significa que SMTP no confirmó el resultado: reintentar puede duplicar el email.</p>
          <div className="mkList">{data.failures.map((f: any) => <div key={f.id}><span>{f.contact.email}</span><Badge status={f.status} /><small>{f.error}</small><button onClick={() => api(`/messages/${f.id}/retry`, 'POST').then(() => { notify.ok('Reencolado'); reload(); }).catch(notify.err)}>Reintentar</button></div>)}</div>
        </section>
      )}
    </>
  );
}
function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="mkKpi"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

// ── Contactos ──
function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
function Contacts({ notify }: { notify: Notify }) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const load = useCallback(() => api<{ items: Contact[]; total: number }>(`/contacts?search=${encodeURIComponent(search)}&status=${status}&page=${page}`), [search, status, page]);
  const [data, reload] = useLoad(load, notify);
  const [editing, setEditing] = useState<Partial<Contact> & { tagsText?: string } | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [importing, setImporting] = useState<{ file: string; rows: Record<string, string>[]; consent: boolean; progress?: string } | null>(null);
  const [klaviyo, setKlaviyo] = useState<any>(null);

  useEffect(() => {
    if (!klaviyo?.running) return;
    const t = setInterval(() => api('/klaviyo/import').then(s => { setKlaviyo(s); if (!s.running) reload(); }).catch(notify.err), 3000);
    return () => clearInterval(t);
  }, [klaviyo?.running, reload, notify.err]);
  useEffect(() => { api('/klaviyo/import').then(setKlaviyo).catch(() => null); }, []);

  async function save() {
    if (!editing) return;
    try {
      const status = ['PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED'].includes(editing.status ?? '') ? editing.status : undefined;
      await api('/contacts', 'POST', { email: editing.email, firstName: editing.firstName ?? '', lastName: editing.lastName ?? '', country: editing.country ?? '', status, consentSource: editing.consentSource, tags: (editing.tagsText ?? '').split(',').map(t => t.trim()).filter(Boolean), consentAt: status === 'SUBSCRIBED' ? editing.consentAt ?? new Date().toISOString() : editing.consentAt });
      notify.ok('Contacto guardado'); setEditing(null); reload();
    } catch (e) { notify.err(e); }
  }
  function pickFile(file: File) {
    file.text().then(text => {
      const [head, ...rest] = parseCsv(text.replace(/^﻿/, ''));
      const find = (re: RegExp) => head.findIndex(h => re.test(h.trim()));
      const cols = { email: find(/^e-?mail$|^email address$/i), firstName: find(/first.?name|^nombre$/i), lastName: find(/last.?name|apellido/i), country: find(/^country$|pa[ií]s/i), consent: find(/email marketing consent$|^consent/i) };
      if (cols.email < 0) return notify.err('El CSV necesita una columna Email.');
      const rows = rest.map(r => Object.fromEntries(Object.entries(cols).filter(([, i]) => i >= 0).map(([k, i]) => [k, (r[i] ?? '').trim()]))).filter(r => r.email);
      setImporting({ file: file.name, rows, consent: false });
    }).catch(notify.err);
  }
  async function runImport() {
    if (!importing) return;
    const now = new Date().toISOString(); let done = 0; const errors: string[] = [];
    for (let i = 0; i < importing.rows.length; i += 500) {
      const contacts = importing.rows.slice(i, i + 500).map(r => {
        const subscribed = r.consent !== undefined ? /^(subscribed|true|yes|s[ií]|1)$/i.test(r.consent) : importing.consent;
        return { email: r.email, firstName: r.firstName, lastName: r.lastName, country: r.country, tags: ['csv'], ...(subscribed ? { status: 'SUBSCRIBED', consentSource: `csv:${importing.file}`.slice(0, 200), consentAt: now } : {}) };
      });
      try { const res = await api<{ imported: number; errors: { row: number; error: string }[] }>('/contacts/import', 'POST', { contacts }); done += res.imported; errors.push(...res.errors.map(e => `Fila ${i + e.row + 1}: ${e.error}`)); }
      catch (e) { notify.err(e); break; }
      setImporting(s => s && { ...s, progress: `${Math.min(i + 500, s.rows.length)} / ${s.rows.length}` });
    }
    notify.ok(`${done} contactos importados${errors.length ? ` · ${errors.length} con error` : ''}`, !errors.length);
    if (errors.length) console.warn(errors.join('\n'));
    setImporting(null); reload();
  }
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));
  return (
    <>
      <Header title="Contactos" subtitle={`${data?.total?.toLocaleString('es-ES') ?? '…'} contactos. Las bajas y rebotes nunca se reactivan al importar.`}>
        <button disabled={klaviyo?.running} onClick={() => confirm('Importar todos los perfiles de Klaviyo con su consentimiento y supresiones? No envía ningún email.') && api('/klaviyo/import', 'POST').then(setKlaviyo).catch(notify.err)}><RefreshCw size={14} /> {klaviyo?.running ? `Klaviyo ${klaviyo.processed}…` : 'Importar de Klaviyo'}</button>
        <label className="mkFileBtn"><Upload size={14} /> CSV<input type="file" accept=".csv,text/csv" hidden onChange={e => e.target.files?.[0] && pickFile(e.target.files[0])} /></label>
        <button className="primary" onClick={() => setEditing({ status: 'PENDING', tagsText: '' })}><Plus size={14} /> Contacto</button>
      </Header>
      {klaviyo && (klaviyo.startedAt) && <div className={`mkNotice ${klaviyo.error ? 'bad' : ''}`}>Importación Klaviyo: {klaviyo.imported} importados, {klaviyo.skipped} sin email de {klaviyo.processed} perfiles{klaviyo.running ? ' (en curso)' : klaviyo.finishedAt ? ` · terminó ${date(klaviyo.finishedAt)}` : ''}{klaviyo.error ? ` · Error: ${klaviyo.error}` : ''}</div>}
      {importing && (
        <section className="panel">
          <h2>Importar {importing.file}</h2>
          <p>{importing.rows.length} filas con email. {importing.rows[0]?.consent !== undefined ? 'El CSV trae columna de consentimiento: se usa fila a fila.' : ''}</p>
          {importing.rows[0]?.consent === undefined && <label className="mkCheck"><input type="checkbox" checked={importing.consent} onChange={e => setImporting({ ...importing, consent: e.target.checked })} />Todos dieron su consentimiento para recibir marketing (si no, quedan como pendientes).</label>}
          <div className="mkRowBtns"><button className="primary" disabled={!!importing.progress} onClick={runImport}>{importing.progress ? `Importando ${importing.progress}` : 'Importar'}</button><button onClick={() => setImporting(null)}>Cancelar</button></div>
        </section>
      )}
      {editing && (
        <section className="panel mkForm">
          <h2>{editing.id ? 'Editar contacto' : 'Nuevo contacto'}</h2>
          <div className="mkFields">
            <label>Email<input value={editing.email ?? ''} disabled={!!editing.id} onChange={e => setEditing({ ...editing, email: e.target.value })} /></label>
            <label>Nombre<input value={editing.firstName ?? ''} onChange={e => setEditing({ ...editing, firstName: e.target.value })} /></label>
            <label>Apellidos<input value={editing.lastName ?? ''} onChange={e => setEditing({ ...editing, lastName: e.target.value })} /></label>
            <label>País<input value={editing.country ?? ''} onChange={e => setEditing({ ...editing, country: e.target.value })} /></label>
            <label>Etiquetas (coma)<input value={editing.tagsText ?? ''} onChange={e => setEditing({ ...editing, tagsText: e.target.value })} /></label>
            {['BOUNCED', 'COMPLAINED'].includes(editing.status ?? '') ? <label>Estado<input disabled value={STATUS[editing.status!][0]} /></label>
              : <label>Estado<select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })}><option value="PENDING">Pendiente</option><option value="SUBSCRIBED">Suscrito</option><option value="UNSUBSCRIBED">Baja</option></select></label>}
            {editing.status === 'SUBSCRIBED' && <label>Origen del consentimiento<input placeholder="p. ej. tienda física, 12/10" value={editing.consentSource ?? ''} onChange={e => setEditing({ ...editing, consentSource: e.target.value })} /></label>}
          </div>
          <div className="mkRowBtns"><button className="primary" onClick={save}>Guardar</button><button onClick={() => setEditing(null)}>Cancelar</button></div>
        </section>
      )}
      <div className="mkToolbar">
        <input className="mkSearch" placeholder="Buscar email o nombre" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todos</option>{['SUBSCRIBED', 'PENDING', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED'].map(s => <option key={s} value={s}>{STATUS[s][0]}</option>)}</select>
      </div>
      <div className="mkTable">
        <table>
          <thead><tr><th>Email</th><th>Nombre</th><th>Estado</th><th>Etiquetas</th><th>Alta</th><th /></tr></thead>
          <tbody>{data?.items.map(c => (
            <tr key={c.id}>
              <td><button className="mkLink" onClick={() => api(`/contacts/${c.id}`).then(setDetail).catch(notify.err)}>{c.email}</button></td>
              <td>{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td><td><Badge status={c.status} /></td>
              <td className="mkTags">{c.tags.map(t => <span key={t}>{t}</span>)}</td><td>{date(c.createdAt)}</td>
              <td className="mkRowBtns">
                <button onClick={() => setEditing({ ...c, tagsText: c.tags.join(', ') })}>Editar</button>
                {['SUBSCRIBED', 'PENDING'].includes(c.status) && <button onClick={() => confirm(`Dar de baja a ${c.email}?`) && api(`/contacts/${c.id}/unsubscribe`, 'POST').then(reload).catch(notify.err)}>Baja</button>}
                <button title="Borrar (RGPD)" onClick={() => confirm(`Borrar ${c.email} y todo su historial? No se puede deshacer.`) && api(`/contacts/${c.id}`, 'DELETE').then(reload).catch(notify.err)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="mkPager"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
      {detail && (
        <div className="mkDrawer"><div>
          <div className="mkDrawerHead"><h2>{detail.email}</h2><button onClick={() => setDetail(null)}><X size={14} /></button></div>
          <p><Badge status={detail.status} /> {detail.consentSource ? `· consentimiento ${detail.consentSource} ${date(detail.consentAt)}` : ''}</p>
          <h3>Eventos</h3>
          <div className="mkList">{detail.events.map((e: any) => <div key={e.id}><span>{e.name}</span><small>{date(e.createdAt)}{e.value ? ` · ${eur(e.value)}` : ''}</small></div>)}{!detail.events.length && <p className="mkMuted">Sin eventos.</p>}</div>
          <h3>Emails</h3>
          <div className="mkList">{detail.messages.map((m: any) => <div key={m.id}><span>{m.campaign?.name ?? m.flow?.name ?? (m.kind === 'CONFIRMATION' ? 'Confirmación' : m.kind)}</span><Badge status={m.status} /><small>{date(m.sentAt ?? m.dueAt)}{m.openedAt ? ' · abierto' : ''}{m.clickedAt ? ' · clic' : ''}</small></div>)}</div>
        </div></div>
      )}
    </>
  );
}

// ── Segmentos ──
function ConditionRow({ c, onChange, onRemove }: { c: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
  const activity = ['event', 'opened', 'clicked', 'created'].includes(c.field);
  return (
    <div className="mkCond">
      <select value={c.field} onChange={e => { const field = e.target.value; onChange(['event', 'opened', 'clicked', 'created'].includes(field) ? { field, operator: 'in_last_days', days: 30, value: field === 'event' ? 'Placed Order' : undefined } : { field, operator: 'is', value: '' }); }}>{FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {activity ? <>
        {c.field === 'event' && <input list="mk-events" value={c.value ?? ''} onChange={e => onChange({ ...c, value: e.target.value })} />}
        <select value={c.operator} onChange={e => onChange({ ...c, operator: e.target.value })}><option value="in_last_days">en los últimos</option><option value="not_in_last_days">no en los últimos</option></select>
        <input type="number" min={1} max={3650} value={c.days ?? 30} onChange={e => onChange({ ...c, days: Number(e.target.value) })} /><span>días</span>
      </> : <>
        <select value={c.operator} onChange={e => onChange({ ...c, operator: e.target.value })}><option value="is">es</option><option value="is_not">no es</option>{c.field !== 'tag' && <option value="contains">contiene</option>}</select>
        <input value={c.value ?? ''} onChange={e => onChange({ ...c, value: e.target.value })} />
      </>}
      <button onClick={onRemove}><X size={13} /></button>
    </div>
  );
}
function Segments({ notify }: { notify: Notify }) {
  const load = useCallback(() => api<Segment[]>('/segments'), []);
  const [items, reload] = useLoad(load, notify);
  const [edit, setEdit] = useState<{ id?: string; name: string; rules: Rules } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!edit) return;
    const t = setTimeout(() => api<{ count: number }>('/segments/preview', 'POST', { rules: edit.rules }).then(r => setCount(r.count)).catch(() => setCount(null)), 400);
    return () => clearTimeout(t);
  }, [edit]);
  async function save() {
    if (!edit) return;
    try { await api(edit.id ? `/segments/${edit.id}` : '/segments', edit.id ? 'PUT' : 'POST', edit); notify.ok('Segmento guardado'); setEdit(null); reload(); } catch (e) { notify.err(e); }
  }
  return (
    <>
      <Header title="Segmentos" subtitle="Audiencias dinámicas: siempre solo contactos suscritos."><button className="primary" onClick={() => setEdit({ name: '', rules: { mode: 'all', conditions: [] } })}><Plus size={14} /> Segmento</button></Header>
      <EventsDatalist />
      {edit && (
        <section className="panel mkForm">
          <div className="mkFields"><label>Nombre<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Cumplir<select value={edit.rules.mode} onChange={e => setEdit({ ...edit, rules: { ...edit.rules, mode: e.target.value as 'all' } })}><option value="all">todas las condiciones</option><option value="any">alguna condición</option></select></label></div>
          {edit.rules.conditions.map((c, i) => <ConditionRow key={i} c={c} onChange={n => setEdit({ ...edit, rules: { ...edit.rules, conditions: edit.rules.conditions.map((x, j) => (j === i ? n : x)) } })} onRemove={() => setEdit({ ...edit, rules: { ...edit.rules, conditions: edit.rules.conditions.filter((_, j) => j !== i) } })} />)}
          <button onClick={() => setEdit({ ...edit, rules: { ...edit.rules, conditions: [...edit.rules.conditions, { field: 'tag', operator: 'is', value: '' }] } })}><Plus size={13} /> Condición</button>
          <p className="mkMuted">Ahora mismo: <b>{count ?? '…'}</b> contactos suscritos.</p>
          <div className="mkRowBtns"><button className="primary" onClick={save}>Guardar</button><button onClick={() => setEdit(null)}>Cancelar</button></div>
        </section>
      )}
      <div className="mkCards">{items?.map(s => (
        <article className="panel" key={s.id}>
          <h2>{s.name}</h2><p><b>{s.count.toLocaleString('es-ES')}</b> contactos · {s.rules.conditions.length} condiciones</p>
          <div className="mkRowBtns"><button onClick={() => setEdit({ id: s.id, name: s.name, rules: s.rules })}>Editar</button><button onClick={() => confirm(`Borrar ${s.name}?`) && api(`/segments/${s.id}`, 'DELETE').then(reload).catch(notify.err)}><Trash2 size={13} /></button></div>
        </article>
      ))}{items && !items.length && <p className="mkMuted">Sin segmentos. Sin segmento, una campaña va a todos los suscritos.</p>}</div>
    </>
  );
}
function EventsDatalist() {
  const [names, setNames] = useState<string[]>(KNOWN_EVENTS);
  useEffect(() => { api<EventInfo[]>('/events').then(e => setNames([...new Set([...KNOWN_EVENTS, ...e.map(x => x.name)])])).catch(() => null); }, []);
  return <datalist id="mk-events">{names.map(n => <option key={n} value={n} />)}</datalist>;
}

// ── Editor de email ──
function EmailEditor({ value, onChange, notify, events }: { value: Content; onChange: (c: Content) => void; notify: Notify; events?: EventInfo[] }) {
  const [html, setHtml] = useState('');
  const [testTo, setTestTo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => api<{ html: string }>('/preview', 'POST', { ...value, name: value.name || 'Vista previa', subject: value.subject || 'Vista previa' }).then(r => setHtml(r.html)).catch(() => null), 450);
    return () => clearTimeout(t);
  }, [value]);
  const set = (i: number, b: Partial<Block>) => onChange({ ...value, blocks: value.blocks.map((x, j) => (j === i ? { ...x, ...b } : x)) });
  const move = (i: number, d: number) => { const blocks = [...value.blocks]; const [b] = blocks.splice(i, 1); blocks.splice(i + d, 0, b); onChange({ ...value, blocks }); };
  const keys = [...new Set((events ?? []).flatMap(e => e.keys))].slice(0, 30);
  return (
    <div className="mkEditor">
      <div>
        <div className="mkFields">
          <label>Nombre interno<input value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} /></label>
          <label>Asunto<input value={value.subject} onChange={e => onChange({ ...value, subject: e.target.value })} /></label>
          <label>Preencabezado<input value={value.preheader} onChange={e => onChange({ ...value, preheader: e.target.value })} /></label>
        </div>
        <p className="mkMuted">Variables: <code>{'{{firstName}}'}</code> <code>{'{{lastName}}'}</code> <code>{'{{email}}'}</code>{keys.map(k => <code key={k}>{`{{event.${k}}}`}</code>)}</p>
        {value.blocks.map((b, i) => (
          <div className="mkBlock" key={i}>
            <div className="mkBlockHead"><b>{{ heading: 'Título', text: 'Texto', button: 'Botón', image: 'Imagen', divider: 'Separador' }[b.type]}</b>
              <span><button disabled={!i} onClick={() => move(i, -1)}><ArrowUp size={12} /></button><button disabled={i === value.blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button><button disabled={value.blocks.length < 2} onClick={() => onChange({ ...value, blocks: value.blocks.filter((_, j) => j !== i) })}><Trash2 size={12} /></button></span></div>
            {b.type !== 'divider' && (b.type === 'text' ? <textarea rows={4} value={b.text ?? ''} onChange={e => set(i, { text: e.target.value })} /> : <input placeholder={b.type === 'image' ? 'Texto alternativo' : ''} value={b.text ?? ''} onChange={e => set(i, { text: e.target.value })} />)}
            {['button', 'image'].includes(b.type) && <input placeholder="https://…  o  {{event.checkoutUrl}}" value={b.url ?? ''} onChange={e => set(i, { url: e.target.value })} />}
          </div>
        ))}
        <div className="mkRowBtns">{(['heading', 'text', 'button', 'image', 'divider'] as const).map(t => <button key={t} onClick={() => onChange({ ...value, blocks: [...value.blocks, { type: t, text: '', url: '' }] })}><Plus size={12} /> {{ heading: 'Título', text: 'Texto', button: 'Botón', image: 'Imagen', divider: 'Separador' }[t]}</button>)}</div>
        <div className="mkToolbar"><input className="mkSearch" placeholder="Enviar prueba a…" value={testTo} onChange={e => setTestTo(e.target.value)} /><button onClick={() => api('/test', 'POST', { ...value, email: testTo }).then(() => notify.ok(`Prueba enviada a ${testTo}`)).catch(notify.err)}><Send size={13} /> Prueba</button></div>
      </div>
      <iframe className="mkPreview" sandbox="" srcDoc={html} title="Vista previa" />
    </div>
  );
}

// ── Plantillas ──
function Templates({ notify }: { notify: Notify }) {
  const load = useCallback(() => api<Template[]>('/templates'), []);
  const [items, reload] = useLoad(load, notify);
  const [edit, setEdit] = useState<(Content & { id?: string }) | null>(null);
  const [events, setEvents] = useState<EventInfo[]>([]);
  useEffect(() => { api<EventInfo[]>('/events').then(setEvents).catch(() => null); }, []);
  async function save() {
    if (!edit) return;
    try { await api(edit.id ? `/templates/${edit.id}` : '/templates', edit.id ? 'PUT' : 'POST', edit); notify.ok('Plantilla guardada'); setEdit(null); reload(); } catch (e) { notify.err(e); }
  }
  if (edit) return (
    <>
      <Header title={edit.id ? 'Editar plantilla' : 'Nueva plantilla'} subtitle="Las automatizaciones usan plantillas; las campañas pueden partir de una."><button onClick={() => setEdit(null)}>Volver</button><button className="primary" onClick={save}>Guardar</button></Header>
      <EmailEditor value={edit} onChange={c => setEdit({ ...edit, ...c })} notify={notify} events={events} />
    </>
  );
  return (
    <>
      <Header title="Plantillas" subtitle="Contenido reutilizable para campañas y automatizaciones."><button className="primary" onClick={() => setEdit(blankContent())}><Plus size={14} /> Plantilla</button></Header>
      <div className="mkCards">{items?.map(t => (
        <article className="panel" key={t.id}><h2>{t.name}</h2><p>{t.subject}</p><small className="mkMuted">Editada {date(t.updatedAt)}</small>
          <div className="mkRowBtns"><button onClick={() => setEdit({ id: t.id, name: t.name, subject: t.subject, preheader: t.preheader, blocks: t.blocks })}>Editar</button><button onClick={() => setEdit({ name: `${t.name} (copia)`, subject: t.subject, preheader: t.preheader, blocks: t.blocks })}><Copy size={13} /></button><button onClick={() => confirm(`Borrar ${t.name}?`) && api(`/templates/${t.id}`, 'DELETE').then(reload).catch(notify.err)}><Trash2 size={13} /></button></div>
        </article>
      ))}{items && !items.length && <p className="mkMuted">Sin plantillas todavía.</p>}</div>
    </>
  );
}

// ── Campañas ──
function Campaigns({ notify }: { notify: Notify }) {
  const load = useCallback(() => api<Campaign[]>('/campaigns'), []);
  const [items, reload] = useLoad(load, notify);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [edit, setEdit] = useState<(Content & { id?: string; segmentId: string }) | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [launch, setLaunch] = useState<{ id: string; count: number | null; when: string; confirmed: boolean } | null>(null);
  useEffect(() => { api<Segment[]>('/segments').then(setSegments).catch(() => null); api<Template[]>('/templates').then(setTemplates).catch(() => null); }, []);
  async function save(): Promise<string | undefined> {
    if (!edit) return;
    try { const saved = await api<Campaign>(edit.id ? `/campaigns/${edit.id}` : '/campaigns', edit.id ? 'PUT' : 'POST', { ...edit, segmentId: edit.segmentId || null }); setEdit({ ...edit, id: saved.id }); notify.ok('Borrador guardado'); reload(); return saved.id; } catch (e) { notify.err(e); }
  }
  async function openLaunch() {
    const id = await save(); if (!id) return;
    setLaunch({ id, count: null, when: '', confirmed: false });
    api<{ count: number }>(`/audience?segmentId=${edit?.segmentId ?? ''}`).then(r => setLaunch(l => l && { ...l, count: r.count })).catch(notify.err);
  }
  async function doLaunch() {
    if (!launch) return;
    try {
      const r = await api<{ queued: number }>(`/campaigns/${launch.id}/launch`, 'POST', { confirm: true, expectedRecipients: launch.count, scheduledAt: launch.when ? new Date(launch.when).toISOString() : undefined });
      notify.ok(`${r.queued} emails ${launch.when ? 'programados' : 'en cola'}`); setLaunch(null); setEdit(null); reload();
    } catch (e) { notify.err(e); }
  }
  if (detail) return (
    <>
      <Header title={detail.name} subtitle={`${detail.subject} · ${STATUS[detail.status]?.[0] ?? detail.status}${detail.scheduledAt ? ` · ${date(detail.scheduledAt)}` : ''}`}>
        <button onClick={() => setDetail(null)}>Volver</button>
        <button onClick={() => api(`/campaigns/${detail.id}/duplicate`, 'POST').then(() => { notify.ok('Duplicada como borrador'); setDetail(null); reload(); }).catch(notify.err)}><Copy size={13} /> Duplicar</button>
        {detail.status === 'SCHEDULED' && <button onClick={() => confirm('Cancelar los envíos pendientes de esta campaña?') && api(`/campaigns/${detail.id}/cancel`, 'POST').then(r => { notify.ok(`${r.cancelled} envíos cancelados`); setDetail(null); reload(); }).catch(notify.err)}>Cancelar envío</button>}
      </Header>
      <div className="mkKpis">
        <Kpi label="Enviados" value={String(detail.stats.sent)} hint={Object.entries(detail.statuses).map(([s, n]) => `${STATUS[s]?.[0] ?? s}: ${n}`).join(' · ')} />
        <Kpi label="Apertura" value={pct(detail.stats.opened, detail.stats.sent)} hint={`${detail.stats.opened} aperturas`} />
        <Kpi label="Clics" value={pct(detail.stats.clicked, detail.stats.sent)} hint={`${detail.stats.clicked} clics`} />
        <Kpi label="Bajas" value={pct(detail.stats.unsubscribed, detail.stats.sent)} hint={`${detail.stats.bounced} rebotes/spam`} />
        <Kpi label="Ingresos" value={eur(detail.stats.revenue)} hint={`${detail.stats.orders} pedidos`} />
      </div>
      <section className="panel"><h2>Últimos envíos</h2><div className="mkList">{detail.messages.map((m: any) => <div key={m.id}><span>{m.contact.email}</span><Badge status={m.status} /><small>{date(m.sentAt)}{m.openedAt ? ' · abierto' : ''}{m.clickedAt ? ' · clic' : ''}{m.error ? ` · ${m.error}` : ''}</small></div>)}</div></section>
    </>
  );
  if (edit) return (
    <>
      <Header title={edit.id ? 'Editar campaña' : 'Nueva campaña'} subtitle="Guarda el borrador, envía una prueba y lanza cuando esté lista.">
        <button onClick={() => setEdit(null)}>Volver</button><button onClick={save}>Guardar borrador</button><button className="primary" onClick={openLaunch}><Send size={13} /> Enviar o programar</button>
      </Header>
      <div className="mkToolbar">
        <label>Audiencia <select value={edit.segmentId} onChange={e => setEdit({ ...edit, segmentId: e.target.value })}><option value="">Todos los suscritos</option>{segments.map(s => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}</select></label>
        {templates.length > 0 && <label>Partir de plantilla <select value="" onChange={e => { const t = templates.find(x => x.id === e.target.value); if (t) setEdit({ ...edit, subject: t.subject, preheader: t.preheader, blocks: t.blocks }); }}><option value="">—</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      </div>
      <EmailEditor value={edit} onChange={c => setEdit({ ...edit, ...c })} notify={notify} />
      {launch && (
        <div className="mkDrawer"><div>
          <div className="mkDrawerHead"><h2>Confirmar envío</h2><button onClick={() => setLaunch(null)}><X size={14} /></button></div>
          <p>Destinatarios: <b>{launch.count ?? '…'}</b> contactos suscritos.</p>
          <label className="mkStack">Programar (vacío = ahora)<input type="datetime-local" value={launch.when} onChange={e => setLaunch({ ...launch, when: e.target.value })} /></label>
          <label className="mkCheck"><input type="checkbox" checked={launch.confirmed} onChange={e => setLaunch({ ...launch, confirmed: e.target.checked })} />He enviado una prueba y quiero mandar esta campaña a {launch.count ?? '…'} personas.</label>
          <button className="primary" disabled={!launch.confirmed || launch.count == null} onClick={doLaunch}>{launch.when ? 'Programar' : 'Enviar ahora'}</button>
        </div></div>
      )}
    </>
  );
  return (
    <>
      <Header title="Campañas" subtitle="Envíos puntuales a todos los suscritos o a un segmento."><button className="primary" onClick={() => setEdit({ ...blankContent(), segmentId: '' })}><Plus size={14} /> Campaña</button></Header>
      <div className="mkTable"><table>
        <thead><tr><th>Campaña</th><th>Estado</th><th>Resultados</th><th>Fecha</th><th /></tr></thead>
        <tbody>{items?.map(c => (
          <tr key={c.id}>
            <td><b>{c.name}</b><br /><small className="mkMuted">{c.subject}</small></td><td><Badge status={c.status} /></td><td><StatRow stats={c.stats} /></td><td>{date(c.scheduledAt ?? c.createdAt)}</td>
            <td className="mkRowBtns">
              {c.status === 'DRAFT' ? <><button onClick={() => setEdit({ id: c.id, name: c.name, subject: c.subject, preheader: c.preheader, blocks: c.blocks, segmentId: c.segmentId ?? '' })}>Editar</button><button onClick={() => confirm(`Borrar ${c.name}?`) && api(`/campaigns/${c.id}`, 'DELETE').then(reload).catch(notify.err)}><Trash2 size={13} /></button></>
                : <button onClick={() => api(`/campaigns/${c.id}`).then(setDetail).catch(notify.err)}>Ver</button>}
            </td>
          </tr>
        ))}</tbody>
      </table>{items && !items.length && <p className="mkMuted">Aún no hay campañas.</p>}</div>
    </>
  );
}

// ── Automatizaciones ──
function Flows({ notify }: { notify: Notify }) {
  const load = useCallback(() => api<Flow[]>('/flows'), []);
  const [items, reload] = useLoad(load, notify);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [edit, setEdit] = useState<(Omit<Flow, 'id' | 'status' | 'stopOnEvent'> & { id?: string; stopOnEvent: string }) | null>(null);
  useEffect(() => { api<Template[]>('/templates').then(setTemplates).catch(() => null); }, []);
  const name = (id: string) => templates.find(t => t.id === id)?.name ?? 'Plantilla borrada';
  async function save() {
    if (!edit) return;
    try { await api(edit.id ? `/flows/${edit.id}` : '/flows', edit.id ? 'PUT' : 'POST', edit); notify.ok('Automatización guardada'); setEdit(null); reload(); } catch (e) { notify.err(e); }
  }
  const status = (f: Flow, live: boolean) => (!live || confirm(`Activar «${f.name}»? Empezará a enviar con cada evento «${f.trigger}» nuevo.`)) && api(`/flows/${f.id}/status`, 'POST', { live }).then(() => { notify.ok(live ? 'Activada' : 'Pausada; envíos en cola cancelados'); reload(); }).catch(notify.err);
  return (
    <>
      <Header title="Automatizaciones" subtitle="Secuencias que arrancan con un evento (Shopify, Mitaller o la web) y paran con otro.">
        <button className="primary" disabled={!templates.length} title={templates.length ? '' : 'Crea antes una plantilla'} onClick={() => setEdit({ name: '', trigger: '', stopOnEvent: '', transactional: false, reentryDays: 0, steps: [{ delayMinutes: 0, templateId: templates[0]?.id ?? '' }] })}><Plus size={14} /> Automatización</button>
      </Header>
      <EventsDatalist />
      {edit && (
        <section className="panel mkForm">
          {!edit.id && <div className="mkRowBtns">{FLOW_PRESETS.map(p => <button key={p.label} onClick={() => setEdit({ ...edit, name: edit.name || p.label, trigger: p.trigger, stopOnEvent: p.stopOnEvent, transactional: !!p.transactional, reentryDays: p.reentryDays, steps: p.delays.map((delayMinutes, i) => ({ delayMinutes, templateId: edit.steps[i]?.templateId ?? templates[0]?.id ?? '' })) })}>{p.label}</button>)}</div>}
          <div className="mkFields">
            <label>Nombre<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Empieza con el evento<input list="mk-events" value={edit.trigger} onChange={e => setEdit({ ...edit, trigger: e.target.value })} /></label>
            <label>Sale si ocurre<input list="mk-events" placeholder="(opcional)" value={edit.stopOnEvent} onChange={e => setEdit({ ...edit, stopOnEvent: e.target.value })} /></label>
            <label>No repetir en (días)<input type="number" min={0} max={365} value={edit.reentryDays} onChange={e => setEdit({ ...edit, reentryDays: Number(e.target.value) })} /></label>
          </div>
          <label className="mkCheck"><input type="checkbox" checked={edit.transactional} onChange={e => setEdit({ ...edit, transactional: e.target.checked })} />Transaccional: llega también a quien no aceptó marketing (devoluciones, reembolsos). Úsalo solo para avisos de servicio, nunca para promociones.</label>
          {edit.steps.map((s, i) => (
            <div className="mkCond" key={i}>
              <span>Paso {i + 1}: esperar</span>
              <input type="number" min={0} value={s.delayMinutes % 1440 === 0 && s.delayMinutes ? s.delayMinutes / 1440 : s.delayMinutes % 60 === 0 && s.delayMinutes ? s.delayMinutes / 60 : s.delayMinutes}
                onChange={e => { const unit = s.delayMinutes % 1440 === 0 && s.delayMinutes ? 1440 : s.delayMinutes % 60 === 0 && s.delayMinutes ? 60 : 1; setEdit({ ...edit, steps: edit.steps.map((x, j) => (j === i ? { ...x, delayMinutes: Math.max(0, Math.round(Number(e.target.value) * unit)) } : x)) }); }} />
              <select value={s.delayMinutes % 1440 === 0 && s.delayMinutes ? 1440 : s.delayMinutes % 60 === 0 && s.delayMinutes ? 60 : 1} onChange={e => { const cur = s.delayMinutes % 1440 === 0 && s.delayMinutes ? s.delayMinutes / 1440 : s.delayMinutes % 60 === 0 && s.delayMinutes ? s.delayMinutes / 60 : s.delayMinutes; setEdit({ ...edit, steps: edit.steps.map((x, j) => (j === i ? { ...x, delayMinutes: (cur || 1) * Number(e.target.value) } : x)) }); }}><option value={1}>min</option><option value={60}>horas</option><option value={1440}>días</option></select>
              <span>y enviar</span>
              <select value={s.templateId} onChange={e => setEdit({ ...edit, steps: edit.steps.map((x, j) => (j === i ? { ...x, templateId: e.target.value } : x)) })}>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <button disabled={edit.steps.length < 2} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })}><X size={13} /></button>
            </div>
          ))}
          <p className="mkMuted">Cada espera cuenta desde el paso anterior.</p>
          <div className="mkRowBtns"><button onClick={() => setEdit({ ...edit, steps: [...edit.steps, { delayMinutes: 1440, templateId: templates[0]?.id ?? '' }] })}><Plus size={13} /> Paso</button><button className="primary" onClick={save}>Guardar</button><button onClick={() => setEdit(null)}>Cancelar</button></div>
        </section>
      )}
      <div className="mkCards">{items?.map(f => (
        <article className="panel" key={f.id}>
          <div className="mkBlockHead"><h2>{f.name}</h2><Badge status={f.status} /></div>
          <p>Evento <b>{f.trigger}</b>{f.stopOnEvent ? <> · sale con <b>{f.stopOnEvent}</b></> : null}{f.transactional ? ' · transaccional' : ''}{f.reentryDays ? ` · 1 vez cada ${f.reentryDays} d` : ''}</p>
          <ol className="mkSteps">{f.steps.map((s, i) => <li key={i}>{delayLabel(s.delayMinutes)} → {name(s.templateId)}</li>)}</ol>
          <p><StatRow stats={f.stats} />{f.queued ? <> · {f.queued} en cola</> : null}</p>
          <div className="mkRowBtns">
            {f.status === 'LIVE' ? <button onClick={() => status(f, false)}><Pause size={13} /> Pausar</button> : <><button className="primary" onClick={() => status(f, true)}><Play size={13} /> Activar</button><button onClick={() => setEdit({ id: f.id, name: f.name, trigger: f.trigger, stopOnEvent: f.stopOnEvent ?? '', transactional: f.transactional, reentryDays: f.reentryDays, steps: f.steps })}>Editar</button><button onClick={() => confirm(`Borrar ${f.name}?`) && api(`/flows/${f.id}`, 'DELETE').then(reload).catch(notify.err)}><Trash2 size={13} /></button></>}
          </div>
        </article>
      ))}{items && !items.length && <p className="mkMuted">Crea primero las plantillas y luego usa un modelo: bienvenida, carrito abandonado, navegación, post-compra, recuperación o devoluciones.</p>}</div>
    </>
  );
}

// ── Formularios ──
function Forms({ notify }: { notify: Notify }) {
  const load = useCallback(() => api<Form[]>('/forms'), []);
  const [items, reload] = useLoad(load, notify);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [edit, setEdit] = useState<(Omit<Form, 'id'> & { id?: string }) | null>(null);
  useEffect(() => { api<Settings>('/settings').then(setSettings).catch(() => null); }, []);
  async function save() {
    if (!edit) return;
    try { await api(edit.id ? `/forms/${edit.id}` : '/forms', edit.id ? 'PUT' : 'POST', edit); notify.ok('Formulario guardado'); setEdit(null); reload(); } catch (e) { notify.err(e); }
  }
  const base = `${settings?.publicApiUrl ?? API}/marketing/public/forms`;
  return (
    <>
      <Header title="Formularios" subtitle="Captación con doble confirmación. Insértalos en Shopify con iframe o formulario HTML."><button className="primary" onClick={() => setEdit({ name: '', headline: 'Únete a Speedwear', description: 'Novedades, drops y ofertas antes que nadie.', buttonText: 'Quiero estar dentro', tag: 'newsletter', active: false })}><Plus size={14} /> Formulario</button></Header>
      {edit && (
        <section className="panel mkForm">
          <div className="mkFields">
            <label>Nombre interno<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Título<input value={edit.headline} onChange={e => setEdit({ ...edit, headline: e.target.value })} /></label>
            <label>Botón<input value={edit.buttonText} onChange={e => setEdit({ ...edit, buttonText: e.target.value })} /></label>
            <label>Etiqueta al suscribirse<input value={edit.tag} onChange={e => setEdit({ ...edit, tag: e.target.value })} /></label>
          </div>
          <label className="mkStack">Descripción<textarea rows={3} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
          <label className="mkCheck"><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Activo (requiere envíos configurados)</label>
          <div className="mkRowBtns"><button className="primary" onClick={save}>Guardar</button><button onClick={() => setEdit(null)}>Cancelar</button></div>
        </section>
      )}
      <div className="mkCards">{items?.map(f => (
        <article className="panel" key={f.id}>
          <div className="mkBlockHead"><h2>{f.name}</h2><Badge status={f.active ? 'LIVE' : 'DRAFT'} /></div>
          <p>{f.headline} · etiqueta <b>{f.tag}</b></p>
          <label className="mkStack">Iframe<textarea readOnly rows={2} value={`<iframe src="${base}/${f.id}" style="width:100%;max-width:480px;height:520px;border:0" title="Newsletter Speedwear"></iframe>`} /></label>
          <label className="mkStack">Formulario HTML (Shopify)<textarea readOnly rows={4} value={`<form action="${base}/${f.id}/subscribe" method="post">\n  <input type="email" name="email" required placeholder="tu@email.com">\n  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">\n  <label><input type="checkbox" name="consent" value="yes" required> Acepto recibir novedades y ofertas por email</label>\n  <button type="submit">${f.buttonText}</button>\n</form>`} /></label>
          <div className="mkRowBtns"><a className="mkLinkBtn" href={`${base}/${f.id}`} target="_blank" rel="noreferrer">Abrir</a><button onClick={() => setEdit({ ...f })}>Editar</button></div>
        </article>
      ))}</div>
    </>
  );
}

// ── Ajustes ──
function SettingsTab({ notify }: { notify: Notify }) {
  const load = useCallback(() => api<Settings>('/settings'), []);
  const [s] = useLoad(load, notify);
  const [events, setEvents] = useState<EventInfo[]>([]);
  useEffect(() => { api<EventInfo[]>('/events').then(setEvents).catch(() => null); }, []);
  const base = s?.publicApiUrl || '<MARKETING_PUBLIC_API_URL>';
  const labels: Record<string, string> = { SMTP_HOST: 'Servidor SMTP', SMTP_USER: 'Usuario SMTP', SMTP_PASSWORD: 'Contraseña SMTP', FROM_EMAIL: 'Remitente', POSTAL_ADDRESS: 'Dirección postal (pie legal)', PUBLIC_API_URL: 'URL pública de la API', PUBLIC_API_URL_HTTPS: 'La URL pública usa https', SEND_ENABLED: 'Envíos habilitados' };
  const snippet = useMemo(() => `{% if template contains 'product' %}\n<script>window.SWM_PRODUCT={id:{{ product.id | json }},title:{{ product.title | json }},url:{{ canonical_url | json }},image:{{ product.featured_image | image_url: width: 600 | prepend: 'https:' | json }},price:{{ product.price | money_without_currency | json }}};</script>\n{% endif %}\n<script src="${base}/marketing/public/onsite.js" async></script>`, [base]);
  if (!s) return <Header title="Ajustes" subtitle="Cargando…" />;
  return (
    <>
      <Header title="Ajustes" subtitle="Las claves viven en variables de entorno de Railway (docs/env.md), nunca en la base de datos." />
      <div className="mkGrid2">
        <section className="panel"><h2>Envío</h2><div className="mkList">{s.checks.map(c => <div key={c.key}><span>{labels[c.key] ?? c.key}</span><span className={`mkBadge ${c.ready ? 'ok' : 'bad'}`}>{c.ready ? 'OK' : 'Falta'}</span></div>)}</div>
          <p className="mkMuted">Remitente: {s.fromName} &lt;{s.fromEmail || '—'}&gt; · lote {s.batchSize} emails / 30 s · atribución {s.attributionDays} días tras clic o apertura.</p></section>
        <section className="panel"><h2>Integraciones</h2><div className="mkList">
          <div><span>Webhooks Shopify (SHOPIFY_WEBHOOK_SECRET)</span><span className={`mkBadge ${s.shopifyWebhooks ? 'ok' : 'bad'}`}>{s.shopifyWebhooks ? 'OK' : 'Falta'}</span></div>
          <div><span>Eventos Mitaller (devoluciones, Crew)</span><span className={`mkBadge ${s.captureEvents ? 'ok' : 'warn'}`}>{s.captureEvents ? 'Capturando' : 'Off'}</span></div>
          <div><span>API de eventos y rebotes (EVENT_SECRET)</span><span className={`mkBadge ${s.integrationConfigured ? 'ok' : 'bad'}`}>{s.integrationConfigured ? 'OK' : 'Falta'}</span></div>
          <div><span>Importación desde Klaviyo</span><span className={`mkBadge ${s.klaviyoImport ? 'ok' : 'muted'}`}>{s.klaviyoImport ? 'Disponible' : 'Sin clave'}</span></div>
        </div></section>
      </div>
      <section className="panel mkForm"><h2>URLs para configurar</h2>
        <label className="mkStack">Shopify → Notificaciones → Webhooks (JSON): checkouts creación/actualización, pedido creado, pedido preparado, cliente creado/actualizado<input readOnly value={`${base}/marketing/integrations/shopify`} /></label>
        <label className="mkStack">Amazon SES → SNS (HTTPS) para rebotes, quejas y entregas<input readOnly value={`${base}/marketing/integrations/ses/<MARKETING_EVENT_SECRET>`} /></label>
        <label className="mkStack">Eventos propios (cabecera x-marketing-secret)<input readOnly value={`POST ${base}/marketing/integrations/events  {"name","externalId","email","properties","value"}`} /></label>
        <label className="mkStack">Shopify theme.liquid antes de &lt;/body&gt; (navegación abandonada)<textarea readOnly rows={5} value={snippet} /></label>
      </section>
      <section className="panel"><h2>Eventos recibidos</h2><div className="mkList">{events.map(e => <div key={e.name}><span>{e.name}</span><small>{e.count} · último {date(e.lastAt)}</small><small className="mkMuted">{e.keys.join(', ')}</small></div>)}{!events.length && <p className="mkMuted">Aún no ha llegado ningún evento.</p>}</div></section>
    </>
  );
}
