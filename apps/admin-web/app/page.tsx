import {
  AlertOctagon,
  AlertTriangle,
  Boxes,
  Calendar,
  ClipboardList,
  Clock,
  Factory,
  Lock,
  PackageCheck,
  RotateCcw,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Truck,
  Wand2
} from 'lucide-react';
import { priorityLabels } from '@mitaller/shared';
import type { ComponentType, SVGProps } from 'react';

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BLOCKED';
type OrderStatus =
  | 'WAITING_PRODUCTION'
  | 'WAITING_STOCK'
  | 'READY_FOR_LABEL'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

const orders: ReadonlyArray<{
  number: string;
  customer: string;
  ref: string;
  method: string;
  status: OrderStatus;
  priority: Priority;
  deadline: string;
}> = [
  { number: '#9464', customer: 'Cliente Express',  ref: 'EXP-001', method: 'Express 24h',      status: 'WAITING_PRODUCTION', priority: 'CRITICAL', deadline: 'Hoy 16:00' },
  { number: '#9465', customer: 'Cliente Standard', ref: 'STD-218', method: 'Correos Estandar', status: 'WAITING_PRODUCTION', priority: 'HIGH',     deadline: 'Hoy 19:00' },
  { number: '#9463', customer: 'Cliente Bloqueado',ref: 'STD-217', method: 'Correos Estandar', status: 'WAITING_STOCK',      priority: 'BLOCKED',  deadline: 'Falta stock' },
  { number: '#9462', customer: 'Cliente Packing',  ref: 'STD-216', method: 'Correos Estandar', status: 'READY_FOR_LABEL',    priority: 'NORMAL',   deadline: 'Listo' }
];

const production: ReadonlyArray<readonly [string, string, string, number, Priority]> = [
  ['Sudadera Fernando',     'Negro',  'L', 1, 'CRITICAL'],
  ['Camiseta MILF',         'Negro',  'M', 1, 'HIGH'],
  ['Camiseta NANO INMORTAL','Blanco', 'M', 1, 'NORMAL']
];

const sections: ReadonlyArray<readonly [string, IconType, string?]> = [
  ['Dashboard',     ClipboardList],
  ['Pedidos',       PackageCheck],
  ['Produccion',    Factory],
  ['Stock interno', Boxes],
  ['Compras',       ShoppingCart],
  ['Falk & Ross',   Wand2],
  ['Recetas/BOM',   ClipboardList],
  ['Sendcloud',     Truck],
  ['Devoluciones',  RotateCcw,   '/admin/devoluciones'],
  ['Configuracion', Settings]
];

const priorityClass: Record<Priority, string> = {
  CRITICAL: 'crit',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
  BLOCKED: 'blocked'
};

const statusMeta: Record<OrderStatus, { cls: string; label: string }> = {
  WAITING_PRODUCTION: { cls: 'pending',  label: 'En espera producción' },
  WAITING_STOCK:      { cls: 'stock',    label: 'Falta stock' },
  READY_FOR_LABEL:    { cls: 'ready',    label: 'Listo etiqueta' },
  IN_PROGRESS:        { cls: 'progress', label: 'En proceso' },
  COMPLETED:          { cls: 'ready',    label: 'Completado' },
  CANCELLED:          { cls: 'cancel',   label: 'Cancelado' }
};

const panels: ReadonlyArray<{ title: string; icon: IconType; rows: string[] }> = [
  { title: 'Stock interno',  icon: Boxes,         rows: ['BLANK-TS-BLK-L · EST-A-01 · 2 uds', 'BLANK-TS-WHT-XL · EST-A-02 · 0 uds', 'TR-FERNANDO · TALLER · 20 uds'] },
  { title: 'Compras',        icon: ShoppingCart,  rows: ['FR-TS-BLK-L · recomendar 8 uds', 'FR-TS-WHT-XL · recomendar 7 uds', 'Proveedor disponible: 120 uds'] },
  { title: 'Falk & Ross',    icon: Wand2,         rows: ['Catalogo real pendiente de fuente', 'Stock proveedor configurado por CSV/XML', 'Busqueda por SKU/talla/color preparada'] },
  { title: 'Recetas/BOM',    icon: ClipboardList, rows: ['prod-fernando -> camiseta lisa + transfer', 'prod-nano -> camiseta blanca + transfer', 'Pegatina -> picking directo'] },
  { title: 'Sendcloud',      icon: Truck,         rows: ['Etiquetas reales con metodo configurado', 'Errores visibles', 'Tracking real al crear etiqueta'] },
  { title: 'Configuracion',  icon: Settings,      rows: ['Reglas de envio', 'Ubicaciones', 'Usuarios', 'Stock minimo'] }
];

export default function Page() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">M</span>
          <span>Mitaller</span>
        </div>

        <nav>
          <div className="navLabel">Menú</div>
          {sections.map(([label, Icon, href], i) => (
            <a
              key={label}
              href={href ?? `#${label.toLowerCase().replaceAll(' ', '-')}`}
              className={i === 0 ? 'active' : ''}
            >
              <Icon size={17} />
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebarFooter">
          <div className="avatar">AV</div>
          <div>
            <div className="name">Angel Velasco</div>
            <div className="role">Operaciones · Taller</div>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="title">
            <h1>Panel operativo</h1>
            <p>Pedidos, producción, stock, compras y envíos en una sola cola de decisiones.</p>
          </div>
          <div className="actions">
            <div className="search">
              <Search size={15} color="#94a3b8" />
              <input placeholder="Buscar pedido, cliente, SKU…" />
              <kbd>⌘K</kbd>
            </div>
            <button className="primary">
              <Sparkles size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              Sincronizar Shopify
            </button>
          </div>
        </header>

        <section id="dashboard" className="metrics">
          <Metric label="Pedidos hoy"        value="5" delta="+2 vs ayer" icon={Calendar}     tone="info" />
          <Metric label="Tareas críticas"    value="1" delta="Express 24h" icon={AlertOctagon} tone="danger" />
          <Metric label="Atrasados"          value="1" delta="Revisar"     icon={Clock}        tone="warn" />
          <Metric label="Bloqueados"         value="1" delta="Falta stock" icon={Lock}         tone="danger" />
          <Metric label="Listos para enviar" value="1" delta="Listo packing" icon={Truck}      tone="success" />
        </section>

        <section id="pedidos" className="section">
          <div className="sectionHeader">
            <div className="left">
              <h2>Pedidos</h2>
              <span className="count">{orders.length} activos</span>
            </div>
            <div className="filters">
              <button className="chip active">Todos</button>
              <button className="chip">Críticos</button>
              <button className="chip">Bloqueados</button>
              <button className="chip">Express</button>
              <button className="chip">Listos</button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Envío</th>
                  <th>Estado</th>
                  <th>Prioridad</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const s = statusMeta[order.status];
                  return (
                    <tr key={order.number}>
                      <td className="cellOrder">
                        {order.number}
                        <small>{order.customer} · {order.ref}</small>
                      </td>
                      <td className="cellMuted">{order.method}</td>
                      <td>
                        <span className={`status ${s.cls}`}>
                          <span className="dot" />
                          {s.label}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${priorityClass[order.priority]}`}>
                          <span className="dot" />
                          {priorityLabels[order.priority]}
                        </span>
                      </td>
                      <td className="cellMuted">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} />
                          {order.deadline}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section id="produccion" className="section twoCols">
          <div>
            <div className="sectionHeader">
              <div className="left"><h2>Producción</h2><span className="count">{production.length} unidades</span></div>
            </div>
            <div className="list">
              {production.map(([product, color, size, quantity, priority]) => (
                <div className="listRow" key={`${product}-${size}`}>
                  <span style={{ fontWeight: 600 }}>{product}</span>
                  <span className="cellMuted">{color} / {size}</span>
                  <strong>×{quantity}</strong>
                  <span className={`badge ${priorityClass[priority]}`}>
                    <span className="dot" />
                    {priorityLabels[priority]}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="sectionHeader">
              <div className="left"><h2>Agrupado</h2><span className="count">3 grupos</span></div>
            </div>
            <div className="list">
              <div className="listRow"><span>Camisetas negras</span><span className="cellMuted">M / L</span><strong>×2</strong><span /></div>
              <div className="listRow"><span>Camisetas blancas</span><span className="cellMuted">M</span><strong>×1</strong><span /></div>
              <div className="listRow"><span>Sudaderas negras</span><span className="cellMuted">L</span><strong>×1</strong><span /></div>
            </div>
          </div>
        </section>

        <section id="stock-interno" className="gridPanels">
          {panels.map((p) => (
            <Panel key={p.title} title={p.title} icon={p.icon} rows={p.rows} />
          ))}
        </section>

        <section id="incidencias" className="notice">
          <div className="noticeIcon"><AlertTriangle size={20} /></div>
          <div>
            <h2>Incidencia bloqueante</h2>
            <p>#9463 bloqueado por falta de camiseta lisa blanca XL. Acción recomendada: generar compra y avisar al responsable.</p>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({
  label, value, delta, icon: Icon, tone
}: {
  label: string;
  value: string;
  delta?: string;
  icon: IconType;
  tone?: 'danger' | 'warn' | 'success' | 'info';
}) {
  return (
    <div className={`metric${tone ? ` tone-${tone}` : ''}`}>
      <div className="label">
        <span className="iconBox"><Icon size={15} /></span>
        {label}
      </div>
      <div className="value">{value}</div>
      {delta && <div className="delta">{delta}</div>}
    </div>
  );
}

function Panel({ title, icon: Icon, rows }: { title: string; icon: IconType; rows: string[] }) {
  return (
    <div className="panel">
      <div className="panelHeader">
        <span className="panelIcon"><Icon size={16} /></span>
        <h2>{title}</h2>
      </div>
      {rows.map((row) => <p key={row}>{row}</p>)}
    </div>
  );
}
