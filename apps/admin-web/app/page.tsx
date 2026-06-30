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

export const dynamic = 'force-dynamic';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'https://mitaller-production-4755.up.railway.app';

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BLOCKED';

type OrderItemDto = {
  id: string;
  title: string | null;
  variantTitle: string | null;
  quantity: number;
  color: string | null;
  size: string | null;
  productType: string | null;
  sku: string | null;
};

type OrderDto = {
  id: string;
  orderNumber: string;
  customerName: string | null;
  shippingMethod: string | null;
  operationalStatus: string | null;
  priorityLevel: Priority | string | null;
  orderedAt: string | null;
  internalDeadlineAt: string | null;
  preparedAt?: string | null;
  items?: OrderItemDto[];
  shipments?: Array<{ id: string; trackingNumber: string | null; status: string | null }>;
};

type PurchaseNeedDto = {
  id: string;
  supplierSku: string | null;
  neededForPendingOrders: number;
  currentInternalStock: number;
  recommendedPurchaseQuantity: number;
  supplierAvailableQuantity: number | null;
  stockItem?: {
    name: string;
    type: string;
    color: string | null;
    size: string | null;
    sku: string;
  } | null;
};

type ShipmentDto = {
  id: string;
  trackingNumber: string | null;
  status: string | null;
  carrier: string | null;
  createdAt: string;
  order?: {
    orderNumber: string;
    customerName: string | null;
    operationalStatus: string | null;
  } | null;
};

type MetricTone = 'info' | 'danger' | 'warn' | 'success';

const sections: ReadonlyArray<readonly [string, IconType, string?]> = [
  ['Dashboard', ClipboardList],
  ['Pedidos', PackageCheck],
  ['Producción', Factory],
  ['Stock interno', Boxes],
  ['Compras', ShoppingCart],
  ['Falk & Ross', Wand2],
  ['Recetas/BOM', ClipboardList],
  ['Sendcloud', Truck],
  ['Devoluciones', RotateCcw, '/admin/devoluciones'],
  ['Configuración', Settings]
];

const priorityClass: Record<Priority, string> = {
  CRITICAL: 'crit',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
  BLOCKED: 'blocked'
};

const statusMeta: Record<string, { cls: string; label: string }> = {
  NEW: { cls: 'pending', label: 'Nuevo' },
  WAITING_STOCK: { cls: 'stock', label: 'Falta stock' },
  WAITING_PRODUCTION: { cls: 'pending', label: 'Sin preparar' },
  IN_PRODUCTION: { cls: 'progress', label: 'En proceso' },
  PRODUCED: { cls: 'ready', label: 'Producido' },
  WAITING_PICKING: { cls: 'pending', label: 'Pendiente picking' },
  PICKED: { cls: 'ready', label: 'Preparado' },
  READY_FOR_LABEL: { cls: 'ready', label: 'Listo etiqueta' },
  LABEL_CREATED: { cls: 'progress', label: 'Etiqueta creada' },
  SHIPPED: { cls: 'ready', label: 'Finalizado' },
  BLOCKED: { cls: 'stock', label: 'Bloqueado' },
  CANCELLED: { cls: 'cancel', label: 'Cancelado' }
};

const finalStatuses = new Set(['SHIPPED', 'CANCELLED']);
const shippingStatuses = new Set(['READY_FOR_LABEL', 'LABEL_CREATED']);
const pendingStatuses = new Set(['NEW', 'WAITING_STOCK', 'WAITING_PRODUCTION', 'IN_PRODUCTION', 'PRODUCED', 'WAITING_PICKING', 'PICKED']);

const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid'
});

const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Europe/Madrid'
});

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, { cache: 'no-store' });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function toPriority(value: Priority | string | null | undefined): Priority {
  if (value === 'CRITICAL' || value === 'HIGH' || value === 'NORMAL' || value === 'LOW' || value === 'BLOCKED') {
    return value;
  }

  return 'NORMAL';
}

function statusInfo(status: string | null | undefined) {
  return statusMeta[status ?? ''] ?? { cls: 'pending', label: status?.replaceAll('_', ' ').toLowerCase() ?? 'Sin estado' };
}

function formatDate(value: string | null | undefined) {
  return value ? dateFormatter.format(new Date(value)) : '-';
}

function dayKey(value: string | null | undefined) {
  return value ? dayFormatter.format(new Date(value)) : '';
}

function sortByPriorityAndAge(a: OrderDto, b: OrderDto) {
  const weights: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, BLOCKED: 2, NORMAL: 3, LOW: 4 };
  const priorityDiff = weights[toPriority(a.priorityLevel)] - weights[toPriority(b.priorityLevel)];

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return new Date(a.orderedAt ?? 0).getTime() - new Date(b.orderedAt ?? 0).getTime();
}

function orderItemLabel(item: OrderItemDto) {
  const bits = [item.color, item.size].filter(Boolean).join(' / ');
  return bits ? `${item.title ?? 'Producto'} · ${bits}` : item.title ?? 'Producto';
}

function topProductionItems(orders: OrderDto[]) {
  return orders
    .flatMap((order) =>
      (order.items ?? []).map((item) => ({
        order,
        item
      }))
    )
    .sort((a, b) => sortByPriorityAndAge(a.order, b.order))
    .slice(0, 8);
}

function groupedItems(orders: OrderDto[]) {
  const groups = new Map<string, { label: string; detail: string; quantity: number }>();

  for (const order of orders) {
    for (const item of order.items ?? []) {
      const label = item.productType || item.title || 'Producto';
      const detail = [item.color, item.size].filter(Boolean).join(' / ') || item.sku || 'Sin variante';
      const key = `${label}-${detail}`;
      const current = groups.get(key) ?? { label, detail, quantity: 0 };
      current.quantity += item.quantity;
      groups.set(key, current);
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);
}

function formatPriority(priority: Priority) {
  return priorityLabels[priority] ?? priority;
}

export default async function Page() {
  const [orders, purchaseNeeds, shipments] = await Promise.all([
    getJson<OrderDto[]>('/orders', []),
    getJson<PurchaseNeedDto[]>('/purchase-needs/today', []),
    getJson<ShipmentDto[]>('/shipments', [])
  ]);

  const today = dayFormatter.format(new Date());
  const activeOrders = orders.filter((order) => !finalStatuses.has(order.operationalStatus ?? ''));
  const pendingOrders = activeOrders.filter((order) => pendingStatuses.has(order.operationalStatus ?? ''));
  const readyToShip = activeOrders.filter((order) => shippingStatuses.has(order.operationalStatus ?? ''));
  const criticalOrders = pendingOrders.filter((order) => toPriority(order.priorityLevel) === 'CRITICAL');
  const blockedOrders = activeOrders.filter((order) => order.operationalStatus === 'WAITING_STOCK' || order.operationalStatus === 'BLOCKED' || toPriority(order.priorityLevel) === 'BLOCKED');
  const overdueOrders = pendingOrders.filter((order) => order.internalDeadlineAt && new Date(order.internalDeadlineAt).getTime() < Date.now());
  const todayOrders = orders.filter((order) => dayKey(order.orderedAt) === today);
  const recommendedPurchases = purchaseNeeds.filter((need) => need.recommendedPurchaseQuantity > 0);
  const productionItems = topProductionItems(pendingOrders);
  const groupedProduction = groupedItems(pendingOrders);
  const recentShipments = shipments.slice(0, 6);
  const sortedOrders = [...pendingOrders, ...readyToShip].sort(sortByPriorityAndAge).slice(0, 12);

  const panels: ReadonlyArray<{ title: string; icon: IconType; rows: string[] }> = [
    {
      title: 'Stock interno',
      icon: Boxes,
      rows: recommendedPurchases.slice(0, 4).map((need) => {
        const item = need.stockItem;
        return `${item?.name ?? need.supplierSku ?? 'Subproducto'} · stock ${need.currentInternalStock} · pedir ${need.recommendedPurchaseQuantity}`;
      })
    },
    {
      title: 'Compras',
      icon: ShoppingCart,
      rows: recommendedPurchases.slice(0, 4).map((need) => {
        const supplier = need.supplierAvailableQuantity == null ? 'stock proveedor sin leer' : `proveedor ${need.supplierAvailableQuantity}`;
        return `${need.stockItem?.name ?? need.supplierSku ?? 'Artículo'} · recomendar ${need.recommendedPurchaseQuantity} · ${supplier}`;
      })
    },
    {
      title: 'Falk & Ross',
      icon: Wand2,
      rows: [
        `${recommendedPurchases.length} líneas pendientes para revisar`,
        `${recommendedPurchases.reduce((sum, need) => sum + need.recommendedPurchaseQuantity, 0)} unidades recomendadas`,
        'Compra final siempre revisada por ti'
      ]
    },
    {
      title: 'Recetas/BOM',
      icon: ClipboardList,
      rows: groupedProduction.slice(0, 3).map((group) => `${group.label} · ${group.detail} · ${group.quantity} uds`)
    },
    {
      title: 'Sendcloud',
      icon: Truck,
      rows: [
        `${readyToShip.length} pedidos en envíos`,
        `${recentShipments.filter((shipment) => shipment.trackingNumber).length} etiquetas/tracking recientes`,
        ...recentShipments.slice(0, 2).map((shipment) => `${shipment.order?.orderNumber ?? 'Pedido'} · ${shipment.carrier ?? 'Transportista'} · ${shipment.status ?? 'sin estado'}`)
      ]
    },
    {
      title: 'Configuración',
      icon: Settings,
      rows: [
        `API: ${apiBaseUrl.replace('https://', '')}`,
        'Reglas de envío y usuarios en backend',
        'Panel web listo para Railway'
      ]
    }
  ];

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
            <p>Pedidos, stock, compras y envíos conectados a la API real de MiTaller.</p>
          </div>
          <div className="actions">
            <div className="search">
              <Search size={15} color="#94a3b8" />
              <input placeholder="Buscar pedido, cliente, SKU…" />
              <kbd>⌘K</kbd>
            </div>
            <a className="primary" href={apiBaseUrl} target="_blank" rel="noreferrer">
              <Sparkles size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              API producción
            </a>
          </div>
        </header>

        <section id="dashboard" className="metrics">
          <Metric label="Pedidos hoy" value={String(todayOrders.length)} delta={`${activeOrders.length} activos`} icon={Calendar} tone="info" />
          <Metric label="Críticos" value={String(criticalOrders.length)} delta="Sin preparar" icon={AlertOctagon} tone="danger" />
          <Metric label="Atrasados" value={String(overdueOrders.length)} delta="Plazo superado" icon={Clock} tone="warn" />
          <Metric label="Bloqueados" value={String(blockedOrders.length)} delta="Falta stock/incidencia" icon={Lock} tone="danger" />
          <Metric label="Listos para enviar" value={String(readyToShip.length)} delta="Etiqueta o envío" icon={Truck} tone="success" />
        </section>

        <section id="pedidos" className="section">
          <div className="sectionHeader">
            <div className="left">
              <h2>Pedidos</h2>
              <span className="count">{sortedOrders.length} visibles · {activeOrders.length} activos</span>
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
                {sortedOrders.map((order) => {
                  const status = statusInfo(order.operationalStatus);
                  const priority = toPriority(order.priorityLevel);

                  return (
                    <tr key={order.id}>
                      <td className="cellOrder">
                        {order.orderNumber}
                        <small>{order.customerName || 'Sin cliente'} · {(order.items ?? []).length} líneas</small>
                      </td>
                      <td className="cellMuted">{order.shippingMethod || 'Sin método'}</td>
                      <td>
                        <span className={`status ${status.cls}`}>
                          <span className="dot" />
                          {status.label}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${priorityClass[priority]}`}>
                          <span className="dot" />
                          {formatPriority(priority)}
                        </span>
                      </td>
                      <td className="cellMuted">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} />
                          {formatDate(order.internalDeadlineAt ?? order.orderedAt)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {sortedOrders.length === 0 && (
                  <tr>
                    <td className="cellMuted" colSpan={5}>No hay pedidos activos para mostrar.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="producción" className="section twoCols">
          <div>
            <div className="sectionHeader">
              <div className="left">
                <h2>Qué preparar ahora</h2>
                <span className="count">{productionItems.length} líneas</span>
              </div>
            </div>
            <div className="list">
              {productionItems.map(({ order, item }) => {
                const priority = toPriority(order.priorityLevel);

                return (
                  <div className="listRow" key={`${order.id}-${item.id}`}>
                    <span style={{ fontWeight: 600 }}>{orderItemLabel(item)}</span>
                    <span className="cellMuted">{order.orderNumber}</span>
                    <strong>×{item.quantity}</strong>
                    <span className={`badge ${priorityClass[priority]}`}>
                      <span className="dot" />
                      {formatPriority(priority)}
                    </span>
                  </div>
                );
              })}
              {productionItems.length === 0 && <div className="listRow"><span className="cellMuted">Sin prendas pendientes.</span></div>}
            </div>
          </div>
          <div>
            <div className="sectionHeader">
              <div className="left">
                <h2>Agrupado</h2>
                <span className="count">{groupedProduction.length} grupos</span>
              </div>
            </div>
            <div className="list">
              {groupedProduction.map((group) => (
                <div className="listRow" key={`${group.label}-${group.detail}`}>
                  <span>{group.label}</span>
                  <span className="cellMuted">{group.detail}</span>
                  <strong>×{group.quantity}</strong>
                  <span />
                </div>
              ))}
              {groupedProduction.length === 0 && <div className="listRow"><span className="cellMuted">Sin agrupaciones pendientes.</span></div>}
            </div>
          </div>
        </section>

        <section id="stock-interno" className="gridPanels">
          {panels.map((p) => (
            <Panel key={p.title} title={p.title} icon={p.icon} rows={p.rows.length > 0 ? p.rows : ['Sin datos pendientes']} />
          ))}
        </section>

        <section id="incidencias" className="notice">
          <div className="noticeIcon"><AlertTriangle size={20} /></div>
          <div>
            <h2>Prioridad de hoy</h2>
            <p>
              Hay {criticalOrders.length} pedidos críticos, {overdueOrders.length} atrasados y {recommendedPurchases.length} líneas de compra recomendada.
              Este panel web ya lee la misma API que usa la app del taller.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, delta, icon: Icon, tone }: { label: string; value: string; delta: string; icon: IconType; tone: MetricTone }) {
  return (
    <article className={`metric tone-${tone}`}>
      <div className="label">
        <span className="iconBox"><Icon size={15} /></span>
        {label}
      </div>
      <div className="value">{value}</div>
      <div className="delta">{delta}</div>
    </article>
  );
}

function Panel({ title, icon: Icon, rows }: { title: string; icon: IconType; rows: string[] }) {
  return (
    <article className="panel">
      <div className="panelHeader">
        <span className="panelIcon"><Icon size={16} /></span>
        <h2>{title}</h2>
      </div>
      {rows.map((row) => <p key={row}>{row}</p>)}
    </article>
  );
}
