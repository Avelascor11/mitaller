# Variables de entorno

Copia `.env.example` a `.env` y configura solo valores locales o secretos gestionados fuera de git.

## Backend

- `DATABASE_URL`: conexion PostgreSQL.
- `JWT_SECRET`: secreto local para firmar JWT.
- `PORT`: puerto HTTP de la API. En local usamos `3001`; en cloud lo suele definir el proveedor.
- `PUBLIC_API_URL`: URL HTTPS publica de la API desplegada. Es la URL que debes poner en la app iOS para que funcione fuera del taller o con el Mac apagado.

## Shopify

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_WEBHOOK_SECRET`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_IMPORT_ORDER_LIMIT`
- `SHOPIFY_MIN_ORDER_NUMBER`

Shopify es obligatorio para importar pedidos. Si faltan dominio o token, la API devuelve error claro en vez de generar datos de prueba. `POST /orders/import-shopify` importa pedidos reales recientes de Shopify. `SHOPIFY_MIN_ORDER_NUMBER` oculta pedidos anteriores en las vistas operativas. Ahora esta configurado en `9341` para reproducir la hoja actual de pedidos sin preparar. Si `SHOPIFY_WEBHOOK_SECRET` esta definido, los webhooks validan HMAC antes de procesar.

## Sendcloud

- `SENDCLOUD_PUBLIC_KEY`
- `SENDCLOUD_SECRET_KEY`
- `SENDCLOUD_API_BASE_URL`
- `SENDCLOUD_API_V3_BASE_URL`
- `SENDCLOUD_DEFAULT_WEIGHT_KG`
- `SENDCLOUD_DEFAULT_LENGTH_CM`
- `SENDCLOUD_DEFAULT_WIDTH_CM`
- `SENDCLOUD_DEFAULT_HEIGHT_CM`
- `SENDCLOUD_SHIPPING_OPTION_CODE`
- `SENDCLOUD_SENDER_ADDRESS_ID`
- `SENDCLOUD_FROM_NAME`
- `SENDCLOUD_FROM_COMPANY_NAME`
- `SENDCLOUD_FROM_ADDRESS_LINE_1`
- `SENDCLOUD_FROM_ADDRESS_LINE_2`
- `SENDCLOUD_FROM_HOUSE_NUMBER`
- `SENDCLOUD_FROM_POSTAL_CODE`
- `SENDCLOUD_FROM_CITY`
- `SENDCLOUD_FROM_COUNTRY_CODE`
- `SENDCLOUD_FROM_PHONE`
- `SENDCLOUD_FROM_EMAIL`
- `SENDCLOUD_SHIPMENT_METHOD_ID`
- `SENDCLOUD_STANDARD_SHIPMENT_METHOD_ID`
- `SENDCLOUD_PREMIUM_SHIPMENT_METHOD_ID`
- `AUTO_PRINT_LABELS`
- `LABEL_PRINTER_NAME`
- `LABEL_PAPER_SIZE`

Sendcloud es obligatorio para crear etiquetas. Si faltan claves, la API devuelve error claro. La creacion de etiquetas usa Shipments API v3 con `POST /shipments/announce-with-shipping-rules`, `apply_shipping_defaults=true` y `apply_shipping_rules=true`, para que entren tus reglas de Sendcloud. `SENDCLOUD_SHIPPING_OPTION_CODE` queda por defecto en `sendcloud:letter`, que Sendcloud recomienda como punto de partida cuando se aplican reglas de envio.

El backend incluye siempre `from_address` en la solicitud. Primero intenta usar `SENDCLOUD_FROM_*`; si no estan definidas, consulta tus direcciones remitente guardadas en Sendcloud y usa la predeterminada o la indicada en `SENDCLOUD_SENDER_ADDRESS_ID`.

Puedes consultar metodos disponibles con `GET /shipments/shipping-methods`. En la cuenta actual aparecen Correos Estandar 0-1kg y Correos Premium 0-1kg como metodos activos, pero la emision real la decide Sendcloud v3 aplicando tus reglas.

Para imprimir etiquetas automaticamente en el taller, instala la Honeywell PC42d en macOS y pon su nombre CUPS exacto en `LABEL_PRINTER_NAME`. Activa `AUTO_PRINT_LABELS=true`. Para etiquetas 100x150 mm usa `LABEL_PAPER_SIZE=Custom.100x150mm`. El backend descarga el PDF de Sendcloud y lo envia con `lp` justo despues de crear la etiqueta.

## Economia

- `ECONOMICS_SHIPPING_COST_STANDARD_ES`: coste estimado para Correos Estandar nacional 0-1 kg. Por defecto `3.81`.
- `ECONOMICS_SHIPPING_COST_PREMIUM_ES`: coste estimado para Correos Premium/Express nacional 0-1 kg. Por defecto `4.26`.
- `ECONOMICS_SHIPPING_COST_LIGHT_ES`: coste estimado para Paq Ligero/carta nacional. Por defecto `3.31`.
- `ECONOMICS_SHIPPING_COST_STANDARD_ES_1_2KG`: coste estimado para Correos Estandar nacional 1-2 kg. Por defecto `3.98`.
- `ECONOMICS_SHIPPING_COST_INTERNATIONAL`: coste estimado para envios internacionales. Por defecto `12.45`.
- `ECONOMICS_WASTE_RATE`: merma estimada sobre coste de producto/impresion. Por defecto `0.02` (2%).
- `ECONOMICS_PAYOUT_LIMIT`: numero maximo de pagos Shopify recientes que se muestran en Economia. Por defecto `8`.

Estos importes salen de la factura Sendcloud `1-26-ES0024751` del 06-05-2026, sumando tarifa base y recargo de combustible aproximado. Si Sendcloud devuelve coste real al crear la etiqueta, la app usa el coste real; si no, usa esta tabla para que un pedido con envio gratis para el cliente siga teniendo coste de transporte en el margen.

La tarjeta "Pagos Shopify" usa los endpoints oficiales de Shopify Payments (`/shopify_payments/payouts.json` y `/shopify_payments/balance/transactions.json`). El token de Shopify debe tener el scope `shopify_payments_payouts` o `shopify_payments`; si no, Shopify devolvera error de permisos.

## Falk & Ross

- `FALKROSS_STOCK_CSV_URL`
- `FALKROSS_STOCK_XML_URL`
- `FALKROSS_ARTICLE_MASTER_URL`

Si faltan fuentes, `SupplierAdapter` devuelve error claro. No se generan articulos ni stock de prueba.

## Frontend

- `NEXT_PUBLIC_API_URL`: API usada por admin web.
- `EXPO_PUBLIC_API_URL`: API usada por Expo.

## Produccion/cloud

Si la API corre en el Mac del taller, la app deja de funcionar cuando ese Mac se apaga. Para produccion, mueve estas variables al panel del proveedor cloud junto con una base PostgreSQL gestionada. Despues cambia la URL de la app iOS a la URL HTTPS publica del servicio.

La impresion automatica de la Honeywell PC42d no puede ejecutarse desde un servidor cloud si la impresora esta conectada por USB/red local al Mac del taller. Para esa parte hace falta mantener un agente local de impresion en el taller o imprimir desde un equipo encendido del taller.
