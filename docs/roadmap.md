# Roadmap

## Fase 1: base MVP

- Monorepo con API, mobile, admin web y paquetes compartidos.
- Prisma con entidades principales.
- Seed de estructura inicial: usuarios, stock, ubicaciones, recetas y proveedor.
- API REST minima.
- `PriorityService`, `PurchaseService` y `StockService`.
- Adaptadores reales Shopify y Sendcloud con errores claros si falta configuracion.
- Pantallas base mobile y admin web.
- Tests unitarios basicos.

## Fase 2: operativa real de taller

- Autenticacion completa con guards y roles.
- Estados operativos mas finos por pedido y tarea.
- Reserva real de componentes por receta.
- Escaneo real con camara y movimientos guiados.
- Detalle de pedido y tarea conectado a API.
- Historial de actividad visible.

## Fase 3: integraciones reales

- Shopify Admin API y webhooks con HMAC.
- Sendcloud real con seleccion de metodo por regla.
- Falk & Ross CSV/XML/ZIP con normalizacion robusta.
- Reintentos, errores y monitorizacion de sincronizaciones.

## Fase 4: compras y planificacion

- Forecast de demanda.
- Reglas editables de prioridad y envio.
- Ordenes de compra por proveedor.
- Alertas de stock minimo y pedidos bloqueados.

## Fase 5: produccion

- Auditoria, permisos, backups y observabilidad.
- CI/CD.
- Builds iOS/Android con Expo/EAS.
- Despliegue backend y admin web.
