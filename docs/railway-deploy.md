# Despliegue en Railway

Railway alojara dos servicios:

- PostgreSQL: base de datos de pedidos, stock, compras, envios y etiquetas.
- API: servidor NestJS que usa la app iPhone.

## 1. Crear proyecto

1. En Railway, crea un proyecto nuevo.
2. Selecciona `Deploy from GitHub repo`.
3. Elige `Avelascor11/mitaller`.

El repo incluye `railway.json`, que fuerza Railway a construir la API con `apps/api/Dockerfile` y a comprobar `/health`.

## 2. Crear Postgres

Dentro del mismo proyecto:

1. Pulsa `+ New`.
2. Selecciona `Database`.
3. Selecciona `PostgreSQL`.

Railway crea automaticamente `DATABASE_URL` en el servicio de Postgres.

## 3. Conectar la API con Postgres

En el servicio de la API, entra en `Variables` y anade:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Si el servicio de Postgres tiene otro nombre en Railway, usa ese nombre en lugar de `Postgres`.

## 4. Variables de la API

Anade estas variables en el servicio de la API:

```text
NODE_ENV=production
JWT_SECRET=
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=
SHOPIFY_API_VERSION=2026-04
SHOPIFY_IMPORT_ORDER_LIMIT=100
SHOPIFY_MIN_ORDER_NUMBER=9454
SENDCLOUD_PUBLIC_KEY=
SENDCLOUD_SECRET_KEY=
SENDCLOUD_API_BASE_URL=https://panel.sendcloud.sc/api/v2
SENDCLOUD_API_V3_BASE_URL=https://panel.sendcloud.sc/api/v3
SENDCLOUD_DEFAULT_WEIGHT_KG=0.3
SENDCLOUD_DEFAULT_LENGTH_CM=30.00
SENDCLOUD_DEFAULT_WIDTH_CM=20.00
SENDCLOUD_DEFAULT_HEIGHT_CM=3.00
SENDCLOUD_STANDARD_SHIPMENT_METHOD_ID=2198
SENDCLOUD_PREMIUM_SHIPMENT_METHOD_ID=2189
AUTO_PRINT_LABELS=false
LABEL_PAPER_SIZE=Custom.100x150mm
```

No pongas secretos en GitHub. Solo en Railway.

## 5. Dominio publico

En el servicio de la API:

1. Entra en `Settings`.
2. Busca `Networking`.
3. Pulsa `Generate Domain`.
4. Comprueba `https://TU-DOMINIO.up.railway.app/health`.

## 6. App iPhone

En la app iPhone, cambia la API URL a:

```text
https://TU-DOMINIO.up.railway.app
```

Desde ese momento la app funcionara aunque el ordenador del taller este apagado.
