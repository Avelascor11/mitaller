import { AlertTriangle, Boxes, ClipboardList, Factory, PackageCheck, Settings, ShoppingCart, Truck, Wand2 } from 'lucide-react';
import { priorityColors, priorityLabels } from '@mitaller/shared';

const orders = [
  { number: '#9464', customer: 'Cliente Express', method: 'Express 24h', status: 'WAITING_PRODUCTION', priority: 'CRITICAL', deadline: 'Hoy 16:00' },
  { number: '#9465', customer: 'Cliente Standard', method: 'Correos Estandar', status: 'WAITING_PRODUCTION', priority: 'HIGH', deadline: 'Hoy 19:00' },
  { number: '#9463', customer: 'Cliente Bloqueado', method: 'Correos Estandar', status: 'WAITING_STOCK', priority: 'BLOCKED', deadline: 'Falta stock' },
  { number: '#9462', customer: 'Cliente Packing', method: 'Correos Estandar', status: 'READY_FOR_LABEL', priority: 'NORMAL', deadline: 'Listo' }
] as const;

const production = [
  ['Sudadera Fernando', 'Negro', 'L', 1, 'CRITICAL'],
  ['Camiseta MILF', 'Negro', 'M', 1, 'HIGH'],
  ['Camiseta NANO INMORTAL', 'Blanco', 'M', 1, 'NORMAL']
] as const;

const sections = [
  ['Dashboard', ClipboardList],
  ['Pedidos', PackageCheck],
  ['Produccion', Factory],
  ['Stock interno', Boxes],
  ['Compras', ShoppingCart],
  ['Falk & Ross', Wand2],
  ['Recetas/BOM', ClipboardList],
  ['Sendcloud', Truck],
  ['Configuracion', Settings]
] as const;

export default function Page() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">Mitaller</div>
        <nav>
          {sections.map(([label, Icon]) => (
            <a key={label} href={`#${label.toLowerCase().replaceAll(' ', '-')}`}>
              <Icon size={18} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <h1>Panel operativo</h1>
            <p>Pedidos, produccion, stock, compras y envios en una sola cola de decisiones.</p>
          </div>
          <button>Sincronizar Shopify</button>
        </header>

        <section id="dashboard" className="metrics">
          <Metric label="Pedidos hoy" value="5" />
          <Metric label="Tareas criticas" value="1" danger />
          <Metric label="Atrasados" value="1" warn />
          <Metric label="Bloqueados" value="1" danger />
          <Metric label="Listos para enviar" value="1" />
        </section>

        <section id="pedidos" className="section">
          <div className="sectionHeader">
            <h2>Pedidos</h2>
            <div className="filters"><button>Todos</button><button>Bloqueados</button><button>Express</button></div>
          </div>
          <table>
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Envio</th><th>Estado</th><th>Prioridad</th><th>Deadline</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.number}>
                  <td>{order.number}</td><td>{order.customer}</td><td>{order.method}</td><td>{order.status}</td>
                  <td><span className="badge" style={{ background: priorityColors[order.priority] }}>{priorityLabels[order.priority]}</span></td>
                  <td>{order.deadline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="produccion" className="section twoCols">
          <div>
            <h2>Produccion</h2>
            <div className="list">
              {production.map(([product, color, size, quantity, priority]) => (
                <div className="listRow" key={`${product}-${size}`}>
                  <span>{product}</span><span>{color} / {size}</span><strong>{quantity}</strong>
                  <span className="badge" style={{ background: priorityColors[priority] }}>{priorityLabels[priority]}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2>Agrupado</h2>
            <div className="list">
              <div className="listRow"><span>Camisetas negras</span><strong>2</strong></div>
              <div className="listRow"><span>Camisetas blancas</span><strong>1</strong></div>
              <div className="listRow"><span>Sudaderas negras</span><strong>1</strong></div>
            </div>
          </div>
        </section>

        <section id="stock-interno" className="section gridPanels">
          <Panel title="Stock interno" rows={['BLANK-TS-BLK-L · EST-A-01 · 2 uds', 'BLANK-TS-WHT-XL · EST-A-02 · 0 uds', 'TR-FERNANDO · TALLER · 20 uds']} />
          <Panel title="Compras" rows={['FR-TS-BLK-L · recomendar 8 uds', 'FR-TS-WHT-XL · recomendar 7 uds', 'Proveedor disponible: 120 uds']} />
          <Panel title="Falk & Ross" rows={['Catalogo real pendiente de fuente', 'Stock proveedor configurado por CSV/XML', 'Busqueda por SKU/talla/color preparada']} />
          <Panel title="Recetas/BOM" rows={['prod-fernando -> camiseta lisa + transfer', 'prod-nano -> camiseta blanca + transfer', 'Pegatina -> picking directo']} />
          <Panel title="Sendcloud" rows={['Etiquetas reales con metodo configurado', 'Errores visibles', 'Tracking real al crear etiqueta']} />
          <Panel title="Configuracion" rows={['Reglas de envio', 'Ubicaciones', 'Usuarios', 'Stock minimo']} />
        </section>

        <section id="incidencias" className="section notice">
          <AlertTriangle size={22} />
          <div>
            <h2>Incidencias</h2>
            <p>#9463 bloqueado por falta de camiseta lisa blanca XL. Accion recomendada: generar compra y avisar al responsable.</p>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, danger, warn }: { label: string; value: string; danger?: boolean; warn?: boolean }) {
  return <div className="metric"><span>{label}</span><strong className={danger ? 'danger' : warn ? 'warn' : ''}>{value}</strong></div>;
}

function Panel({ title, rows }: { title: string; rows: string[] }) {
  return <div className="panel"><h2>{title}</h2>{rows.map((row) => <p key={row}>{row}</p>)}</div>;
}
