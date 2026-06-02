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
- `ECONOMICS_TAX_RESERVE_RATE`: reserva fiscal para proteger flujo de caja. Por defecto `0.15` (15%).

## Banco / PSD2

- `GOCARDLESS_BANK_API_BASE_URL`: URL de GoCardless Bank Account Data. Por defecto `https://bankaccountdata.gocardless.com/api/v2`.
- `GOCARDLESS_SECRET_ID`: secret id de GoCardless Bank Account Data. No subir a GitHub.
- `GOCARDLESS_SECRET_KEY`: secret key de GoCardless Bank Account Data. No subir a GitHub.
- `PUBLIC_API_URL`: URL publica de la API en Railway.
- `BANK_REDIRECT_URL`: callback publico que usara el banco tras autorizar, normalmente `${PUBLIC_API_URL}/bank/callback`.

## Klaviyo

- `KLAVIYO_API_KEY`: clave privada de Klaviyo para enviar eventos de devoluciones. No subir a GitHub. Si no está configurada, la API ignora esos eventos y no bloquea el flujo.
- `ECONOMICS_PAYOUT_LIMIT`: numero maximo de pagos Shopify recientes que se muestran en Economia. Por defecto `8`.

Estos importes salen de la factura Sendcloud `1-26-ES0024751` del 06-05-2026, sumando tarifa base y recargo de combustible aproximado. Si Sendcloud devuelve coste real al crear la etiqueta, la app usa el coste real; si no, usa esta tabla para que un pedido con envio gratis para el cliente siga teniendo coste de transporte en el margen.

La tarjeta "Pagos Shopify" usa los endpoints oficiales de Shopify Payments (`/shopify_payments/payouts.json` y `/shopify_payments/balance/transactions.json`). El token de Shopify debe tener el scope `shopify_payments_payouts` o `shopify_payments`; si no, Shopify devolvera error de permisos.

## Falk & Ross

- `FALKROSS_STOCK_CSV_URL`
- `FALKROSS_STOCK_XML_URL`
- `FALKROSS_ARTICLE_MASTER_URL`
- `FALKROSS_DAILY_AUTO_ORDER`: si vale `true`, a las 20:00 Europe/Madrid se genera un borrador de pedido diario.
- `FALKROSS_ALLOW_AUTO_SUBMIT`: debe quedarse en `false`. Solo existe como seguro técnico para impedir envíos automáticos.
- `FALKROSS_AUTO_ORDER_ENABLED`: si vale `true`, permite enviar el pedido real solo cuando tú pulses la acción manual de envío. Si vale `false`, todo queda como borrador interno.
- `FALKROSS_SYNC_STOCK_BEFORE_ORDER`: si no vale `false`, intenta sincronizar stock proveedor antes de crear el pedido diario.
- `FALKROSS_ORDER_MODE`: `falkross-xml` para el webservice oficial o `draft` para no enviar nunca.
- `FALKROSS_ORDER_ENDPOINT`: por defecto `https://ws.falk-ross.eu/webservice/R02_000/order?format=xml`.
- `FALKROSS_WEBSERVICE_USER`
- `FALKROSS_WEBSERVICE_PASSWORD`
- `FALKROSS_CUSTOMER_NUMBER`
- `FALKROSS_SHIPPING_METHOD`: por defecto `0`.
- `FALKROSS_PARTIAL_SHIPMENT`: por defecto `true`.
- `FALKROSS_ALLOW_BACKORDER`: si vale `false`, no pide mas unidades que el stock proveedor disponible cuando lo conocemos.
- `FALKROSS_DELIVERY_ADDRESS_DIFFERENT`: si vale `false`, Falk & Ross usa la direccion de cuenta. Si vale `true`, rellena tambien las variables `FALKROSS_DELIVERY_*`.

El webservice de Falk & Ross usa Basic Auth y XML UTF-8. No metas usuario/contraseña en URLs. El control final lo tiene el responsable del taller: el cron solo prepara el borrador; el envío real requiere acción manual sobre el pedido revisado.

Prendas base configuradas:

- Camisetas normales: B&C `TG002`, numero de producto `032.42`.
- Camiseta marron: codigo proveedor `2000`, numero de producto `102.09`.
- Sudaderas por defecto: B&C `WG005`, numero de producto `237.42`.
- Comentario enviado en `order_note`: `Camiseta 032.42 -> 2.73 EUR`, `Sudadera 290.09 -> 7.30 EUR`, `Sudadera 237.42 -> 6.60 EUR`, `Sudadera 240.42 -> 6.00 EUR`.

El pedido a proveedor no debe enviar estos codigos de modelo directamente. Antes de crear el XML, la API busca en `SupplierArticle` la variante exacta por modelo + color + talla y usa el `supplierSku` largo de Falk & Ross como `p_sku`.

## Frontend

- `NEXT_PUBLIC_API_URL`: API usada por admin web.
- `EXPO_PUBLIC_API_URL`: API usada por Expo.

## Produccion/cloud

Si la API corre en el Mac del taller, la app deja de funcionar cuando ese Mac se apaga. Para produccion, mueve estas variables al panel del proveedor cloud junto con una base PostgreSQL gestionada. Despues cambia la URL de la app iOS a la URL HTTPS publica del servicio.

La impresion automatica de la Honeywell PC42d no puede ejecutarse desde un servidor cloud si la impresora esta conectada por USB/red local al Mac del taller. Para esa parte hace falta mantener un agente local de impresion en el taller o imprimir desde un equipo encendido del taller.
