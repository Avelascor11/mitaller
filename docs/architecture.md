# Arquitectura

## Vision general

Flujo objetivo:

```text
Shopify -> App propia -> PostgreSQL -> Taller / Stock / Compras / Sendcloud
```

La app se divide en tres superficies:

- API NestJS: reglas de negocio, persistencia, integraciones, webhooks y jobs.
- Mobile Expo: herramienta diaria del taller para fabricar, preparar, mover stock y resolver incidencias.
- Admin web Next.js: panel de supervision para pedidos, produccion, stock, compras, recetas, proveedor y envios.

## Modulos backend

- `Auth`: login basico con JWT.
- `Orders`: importacion real desde Shopify, listado, detalle y webhooks Shopify.
- `Priority`: calculo de deadline interno y prioridad operativa.
- `Production`: cola de tareas y acciones de empezar, completar o bloquear.
- `Stock`: consulta de stock, ubicaciones, movimientos y logs.
- `Purchasing`: generacion de necesidades de compra.
- `Shipments`: creacion real de etiquetas Sendcloud cuando hay metodo configurado.
- `Recipes`: relacion producto Shopify -> componentes internos.
- `Supplier`: adaptador Falk & Ross para catalogo y stock.
- `Activity`: auditoria de acciones operativas.

## Flujo Shopify a taller

1. Shopify crea o actualiza un pedido.
2. La API recibe webhook o ejecuta importacion programada.
3. `PriorityService` calcula `internalDeadlineAt` y `priorityLevel`.
4. El pedido genera tareas internas por linea: fabricacion o picking, preparacion y envio.
5. El taller ve la cola ordenada por urgencia en mobile.
6. Stock y movimientos actualizan ubicaciones y actividad.
7. Cuando el pedido esta preparado, Sendcloud crea parcela y etiqueta.

## Integraciones reales

Los adaptadores fallan de forma explicita si faltan variables de entorno obligatorias:

- `ShopifyAdapter`
- `SendcloudAdapter`
- `SupplierAdapter` para Falk & Ross

La validacion HMAC de webhooks Shopify se ejecuta cuando `SHOPIFY_WEBHOOK_SECRET` esta configurado.
