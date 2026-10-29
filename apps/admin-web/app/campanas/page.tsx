import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileCode2,
  FileText,
  Mail,
  Megaphone,
  PackageOpen,
  ShieldAlert,
  Store
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const campaignAssets = [
  {
    name: 'sw-backstage-rebajas.liquid',
    type: 'Sección Shopify validada',
    path: 'output/shopify-backstage/sections/sw-backstage-rebajas.liquid'
  },
  {
    name: 'Guía rebajas agosto',
    type: 'PDF operativo',
    path: 'output/pdf/guia_rebajas_agosto_speedwear.pdf'
  },
  {
    name: 'Instalación modo backstage',
    type: 'Documento de pasos',
    path: 'output/shopify-backstage/docs/instalacion_modo_backstage.md'
  },
  {
    name: 'Variantes de secciones',
    type: 'Pruebas Liquid',
    path: 'output/shopify-backstage/sections'
  }
];

const launchChecklist = [
  'Duplicar el tema activo antes de tocar Shopify.',
  'Crear la sección sw-backstage-rebajas.liquid en sections.',
  'Añadir SpeedWear en boxes como primer bloque de la home.',
  'Mantener web, productos y carrito abiertos hasta el lanzamiento.',
  'Cambiar el botón principal a Rebajas de Agosto al abrir campaña.'
];

const timeline = [
  {
    label: 'Preparación',
    date: 'Ahora',
    detail: 'Home con backstage, captura de interés y productos normales disponibles.'
  },
  {
    label: 'Cierre parcial',
    date: 'Noche previa',
    detail: 'Reducir banners de compra agresivos, mantener navegación y carrito.'
  },
  {
    label: 'Apertura',
    date: 'Día de lanzamiento · 10:00',
    detail: 'Activar colección de rebajas y cambiar CTA a la colección final.'
  }
];

export default function CampaignsPage() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">M</span>
          <span>Mitaller</span>
        </div>

        <nav>
          <div className="navLabel">Menú</div>
          <a href="/">
            <ClipboardCheck size={17} />
            <span>Dashboard</span>
          </a>
          <a href="/marketing">
            <Mail size={17} />
            <span>Email marketing</span>
          </a>
          <a className="active" href="/campanas">
            <Megaphone size={17} />
            <span>Campañas</span>
          </a>
          <a href="/admin/devoluciones">
            <PackageOpen size={17} />
            <span>Devoluciones</span>
          </a>
        </nav>

        <div className="sidebarFooter">
          <div className="avatar">AV</div>
          <div>
            <div className="name">Angel Velasco</div>
            <div className="role">Marketing · Operaciones</div>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="title">
            <h1>Campañas</h1>
            <p>Material de rebajas, modo backstage y pasos de activación para Shopify.</p>
          </div>
          <div className="actions">
            <a className="primary" href="#assets">
              <FileCode2 size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Ver assets
            </a>
          </div>
        </header>

        <section className="campaignHero">
          <div>
            <span className="campaignEyebrow">Rebajas de agosto</span>
            <h2>SpeedWear en boxes</h2>
            <p>
              La campaña está preparada como modo evento: la web sigue abierta, la home crea expectación y la colección de rebajas se activa cuando toque.
            </p>
          </div>
          <div className="campaignStats">
            <div>
              <strong>12</strong>
              <span>secciones Liquid</span>
            </div>
            <div>
              <strong>1</strong>
              <span>guía PDF</span>
            </div>
            <div>
              <strong>0</strong>
              <span>cierre total recomendado</span>
            </div>
          </div>
        </section>

        <section className="gridPanels campaignGrid">
          <article className="panel">
            <div className="panelHeader">
              <span className="panelIcon"><Store size={16} /></span>
              <h2>Estrategia</h2>
            </div>
            <p>Backstage como primer bloque de la home, sin bloquear compras normales.</p>
            <p>La colección de rebajas se mantiene oculta hasta el momento de apertura.</p>
          </article>

          <article className="panel">
            <div className="panelHeader">
              <span className="panelIcon"><CalendarClock size={16} /></span>
              <h2>Activación</h2>
            </div>
            <p>Apertura prevista a las 10:00, con cambio de CTA hacia la colección final.</p>
            <p>El countdown solo debe vivir mientras la campaña todavía no esté abierta.</p>
          </article>

          <article className="panel">
            <div className="panelHeader">
              <span className="panelIcon"><ShieldAlert size={16} /></span>
              <h2>Cuidado</h2>
            </div>
            <p>No activar contraseña en toda la tienda salvo que quieras perder venta directa.</p>
            <p>Duplicar tema antes de pegar cualquier sección Liquid.</p>
          </article>
        </section>

        <section className="section twoCols">
          <div>
            <div className="sectionHeader">
              <div className="left">
                <h2>Checklist de lanzamiento</h2>
                <span className="count">{launchChecklist.length} pasos</span>
              </div>
            </div>
            <div className="campaignChecklist">
              {launchChecklist.map((item) => (
                <div className="campaignChecklistItem" key={item}>
                  <CheckCircle2 size={16} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="sectionHeader">
              <div className="left">
                <h2>Timeline</h2>
                <span className="count">3 fases</span>
              </div>
            </div>
            <div className="campaignTimeline">
              {timeline.map((step) => (
                <div className="campaignTimelineItem" key={step.label}>
                  <strong>{step.label}</strong>
                  <span>{step.date}</span>
                  <p>{step.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="assets" className="section">
          <div className="sectionHeader">
            <div className="left">
              <h2>Assets añadidos</h2>
              <span className="count">{campaignAssets.length} grupos</span>
            </div>
          </div>
          <div className="assetList">
            {campaignAssets.map((asset) => (
              <article className="assetRow" key={asset.path}>
                <span className="assetIcon">
                  <FileText size={17} />
                </span>
                <div>
                  <strong>{asset.name}</strong>
                  <p>{asset.type}</p>
                </div>
                <code>{asset.path}</code>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
