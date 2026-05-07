# Mitaller

MVP operativo para gestionar pedidos, produccion, stock, compras y envios de una tienda Shopify de ropa/merchandising.

El proyecto esta planteado como monorepo:

- `apps/api`: API NestJS, Prisma, PostgreSQL, jobs e integraciones reales.
- `Mitaller.xcodeproj`: app iOS nativa en SwiftUI para el taller.
- `apps/mobile`: app Expo base para iOS y Android, mantenida como alternativa multiplataforma.
- `apps/admin-web`: panel admin Next.js para el responsable del negocio.
- `packages/shared` y `packages/types`: tipos y utilidades compartidas.
- `infra`: servicios locales, de momento PostgreSQL.

## Requisitos

- Node.js 22 o superior.
- npm 10 o superior.
- Docker Desktop para PostgreSQL.
- Xcode para la app iOS nativa.
- Expo Go o simulador iOS/Android si quieres usar la app Expo.

## Instalacion

```bash
npm install
cp .env.example .env
```

No incluyas credenciales reales en el repositorio. Las integraciones fallan con un error claro cuando faltan variables de entorno obligatorias.

## Activar Shopify y Sendcloud reales

Edita `.env`:

```env
SHOPIFY_SHOP_DOMAIN="tu-tienda.myshopify.com"
SHOPIFY_ADMIN_ACCESS_TOKEN="shpat_..."
SHOPIFY_WEBHOOK_SECRET="..."
SHOPIFY_API_VERSION="2026-04"
SHOPIFY_IMPORT_ORDER_LIMIT=100
SHOPIFY_MIN_ORDER_NUMBER=9454
SENDCLOUD_PUBLIC_KEY="..."
SENDCLOUD_SECRET_KEY="..."
SENDCLOUD_API_V3_BASE_URL=https://panel.sendcloud.sc/api/v3
SENDCLOUD_SHIPPING_OPTION_CODE=sendcloud:letter
SENDCLOUD_SENDER_ADDRESS_ID=
SENDCLOUD_SHIPMENT_METHOD_ID=
SENDCLOUD_STANDARD_SHIPMENT_METHOD_ID=
SENDCLOUD_PREMIUM_SHIPMENT_METHOD_ID=
AUTO_PRINT_LABELS=false
LABEL_PRINTER_NAME=
LABEL_PAPER_SIZE=Custom.100x150mm
```

Con `SHOPIFY_SHOP_DOMAIN` y `SHOPIFY_ADMIN_ACCESS_TOKEN`, el backend importa pedidos reales de Shopify. Sin esas variables, la API devuelve error y no genera datos de prueba.

Para la Honeywell PC42d, instala la impresora en macOS y pon el nombre exacto que salga en `lpstat -p` dentro de `LABEL_PRINTER_NAME`. Con `AUTO_PRINT_LABELS=true`, al crear una etiqueta de Sendcloud se envia automaticamente a imprimir en formato 100x150 mm.

Despues:

```bash
npm run dev:api
```

En Xcode, abre `Mitaller.xcodeproj`. En simulador puedes usar `http://localhost:3001` como API URL. En iPhone fisico dentro del taller puedes usar la IP local del Mac, por ejemplo `http://192.168.1.45:3001`.

Para que la app funcione con el ordenador apagado, no uses una IP local: despliega la API y PostgreSQL en un servidor/cloud y pon la URL HTTPS publica en la pestaña Admin de la app iOS.

## Base de datos

```bash
npm run db:up
npm run prisma:generate
npm run prisma:push
npm run seed
```

Para entornos ya versionados con migraciones, puedes usar `npm run prisma:migrate`.

Login demo tras ejecutar seed:

```text
admin@mitaller.local / demo1234
```

## Ejecutar

Backend:

```bash
npm run dev:api
```

Backend siempre arrancado en este Mac:

```bash
npm run service:api:install
```

Esto instala un LaunchAgent de macOS (`com.mitaller.api`) que arranca la API al iniciar sesion y la reinicia si se cae. Los logs quedan en `logs/api.out.log` y `logs/api.err.log`.
La configuracion privada se copia a `~/Library/Application Support/Mitaller/.env` para que macOS permita leerla desde el servicio.

Esto mantiene la API viva mientras el Mac este encendido. Si el Mac esta apagado, la app necesita el despliegue cloud descrito abajo.

Para pararlo y eliminarlo:

```bash
npm run service:api:uninstall
```

Admin web:

```bash
npm run dev:admin
```

Mobile iOS/Android con Expo:

```bash
npm run dev:mobile
```

iOS nativo:

```bash
open Mitaller.xcodeproj
```

Arranca la API antes de usar sincronizacion real. Si la API no esta disponible, la app iOS muestra error de conexion y no rellena datos de prueba.

Tests:

```bash
npm test
```

## Primera fase

Esta primera entrega crea la base mantenible: modelos principales, API REST, servicios de prioridad, compras y stock, adaptadores para Shopify/Sendcloud/Falk & Ross sin fallback de prueba, seed, app iOS nativa, pantallas base de taller y panel admin.

Shopify funciona en modo real si `.env` contiene dominio y token Admin. Sendcloud exige claves y un metodo configurado. Puedes usar `SENDCLOUD_SHIPMENT_METHOD_ID` para todo o separar `SENDCLOUD_STANDARD_SHIPMENT_METHOD_ID` y `SENDCLOUD_PREMIUM_SHIPMENT_METHOD_ID`.

## Despliegue cloud

La app iOS tiene una parte cliente y una parte servidor. Para que funcione aunque el ordenador del taller este apagado, la parte servidor debe vivir fuera del Mac:

- API NestJS en un servicio web cloud.
- PostgreSQL gestionado.
- Variables de entorno configuradas en el panel del proveedor.
- URL HTTPS publica puesta en la app iOS, pestaña Admin.

El repo incluye:

- `apps/api/Dockerfile`: contenedor de produccion de la API.
- `render.yaml`: blueprint para desplegar API + PostgreSQL en Render.
- `GET /health`: comprobacion de salud para el proveedor cloud.

Flujo recomendado:

1. Crear el servicio cloud usando `render.yaml`.
2. Configurar las variables secretas en el proveedor: Shopify, Sendcloud, `JWT_SECRET`.
3. Ejecutar `prisma db push` y `seed` apuntando al `DATABASE_URL` cloud.
4. Abrir la app iOS, ir a Admin y cambiar `API URL` por la URL HTTPS publica.
5. Probar `/health`, importar Shopify y crear una etiqueta.

Importante sobre impresion: la Honeywell PC42d esta conectada al ordenador del taller. Si la API vive en cloud, el cloud no puede imprimir directamente en esa impresora USB/local. Para imprimir automaticamente hay que dejar un pequeno servicio local de impresion en el Mac del taller, o imprimir desde la app/ordenador cuando se cree la etiqueta.
