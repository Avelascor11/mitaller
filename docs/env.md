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

## Impresion DTF automatica

- `DTF_AUTO_PRINT_ENABLED`: en Railway, si vale `true`, la API crea trabajos de impresion DTF cada pocos minutos cuando haya pedidos sin preparar que necesiten DTF y no exista stock DTF suficiente.
- `PRINT_AGENT_TOKEN`: secreto compartido entre Railway y el ordenador del taller para proteger las colas de impresion.
- `DTF_PRINT_ENABLED`: en el ordenador del taller, si vale `true`, el `print-agent` tambien recoge trabajos DTF.
- `DTF_HOT_FOLDER`: carpeta de entrada del RIP/software DTF. Recomendado si la impresora automatica trabaja con hot folder.
- `DTF_PRINTER_NAME`: nombre de impresora del sistema si no hay hot folder.
- `DTF_PRINT_SETTINGS`: ajustes de SumatraPDF en Windows para impresion directa. Por defecto `fit`.
- `DTF_PRINT_QUEUE_BATCH_SIZE`: numero maximo de trabajos que Railway entrega al agente en cada ronda. Por defecto `3`.

Flujo recomendado: Railway calcula lo que falta, crea `DtfPrintJob`, el PC del taller descarga el archivo del diseno y lo deja en `DTF_HOT_FOLDER` tantas veces como unidades falten. Cuando el agente confirma el envio, la API suma esas unidades al stock DTF en `TALLER`.

## Economia

- `ECONOMICS_SHIPPING_COST_STANDARD_ES`: coste estimado para Correos Estandar nacional 0-1 kg. Por defecto `3.81`.
- `ECONOMICS_SHIPPING_COST_PREMIUM_ES`: coste estimado para Correos Premium/Express nacional 0-1 kg. Por defecto `4.26`.
- `ECONOMICS_SHIPPING_COST_LIGHT_ES`: coste estimado para Paq Ligero/carta nacional. Por defecto `3.31`.
- `ECONOMICS_SHIPPING_COST_STANDARD_ES_1_2KG`: coste estimado para Correos Estandar nacional 1-2 kg. Por defecto `3.98`.
- `ECONOMICS_SHIPPING_COST_INTERNATIONAL`: coste estimado para envios internacionales. Por defecto `12.45`.
- `ECONOMICS_WASTE_RATE`: merma estimada sobre coste de producto/impresion. Por defecto `0.02` (2%).
- `ECONOMICS_TAX_RESERVE_RATE`: reserva fiscal para proteger flujo de caja. Por defecto `0.15` (15%).

## Banco / PSD2

Mitaller usa GoCardless Bank Account Data para conectar N26 por Open Banking/PSD2. No guardes usuario ni contrasena del banco en la app.

- `GOCARDLESS_BANK_API_BASE_URL`: URL de GoCardless Bank Account Data. Por defecto `https://bankaccountdata.gocardless.com/api/v2`.
- `GOCARDLESS_SECRET_ID`: secret id de GoCardless Bank Account Data. No subir a GitHub.
- `GOCARDLESS_SECRET_KEY`: secret key de GoCardless Bank Account Data. No subir a GitHub.
- `PUBLIC_API_URL`: URL publica de la API en Railway.
- `BANK_REDIRECT_URL`: callback publico que usara el banco tras autorizar, normalmente `${PUBLIC_API_URL}/bank/callback`.
- `CASH_SAFETY_BUFFER_EUR`: colchon minimo que el gestor intenta proteger antes de aprobar gastos. Por defecto `500`.
- `GROWTH_MAX_PENDING_ORDERS_BEFORE_HOLD`: pedidos pendientes a partir de los que el control de crecimiento recomienda no escalar Ads. Por defecto `35`.
- `GROWTH_MAX_DAILY_ADS_SCALE_EUR`: subida maxima diaria recomendada para Ads. Por defecto `50`.
- `GROWTH_TSHIRT_UNIT_COST`: coste estimado de camiseta para decisiones de caja. Por defecto `3.19`.
- `GROWTH_GILDAN_TSHIRT_UNIT_COST`: coste estimado de camisetas Gildan marron/rosa. Por defecto `2.84`.
- `GROWTH_SWEATSHIRT_UNIT_COST`: coste estimado de sudadera para decisiones de caja. Por defecto `8.05`.

## UGC / videos de influencers

- `UGC_STORAGE_PROVIDER`: por defecto `local`.
- `UGC_STORAGE_DIR`: carpeta donde la API guarda videos UGC. En Railway debe apuntar a un Volume persistente, por ejemplo `/data/ugc`.
- `UGC_MAX_UPLOAD_MB`: tamano maximo por video. Por defecto `250`.

Postgres guarda los metadatos del video, no el archivo pesado. El archivo vive en `UGC_STORAGE_DIR`. Si el servicio corre en Railway sin Volume persistente, los videos pueden perderse al redeploy. Para volumen alto, el siguiente paso natural es cambiar `UGC_STORAGE_PROVIDER` a Cloudflare R2/S3.

## IA Speedwear

- `OPENAI_API_KEY`: clave de OpenAI para activar conversación real en la pestaña IA Speedwear. Si falta, la app sigue funcionando en modo fallback con reglas internas.
- `OPENAI_MODEL`: modelo usado por la IA. Por defecto `gpt-4.1-mini`.
- `OPENAI_BASE_URL`: endpoint compatible con OpenAI Responses API. Por defecto `https://api.openai.com/v1`.

IA Speedwear lee contexto operativo de pedidos, compras, stock, envíos, caja, influs y Meta Ads. Las acciones reales siguen requiriendo confirmación en la app.

## Klaviyo

- `KLAVIYO_API_KEY`: clave privada de Klaviyo para enviar eventos de devoluciones. No subir a GitHub. Si no está configurada, la API ignora esos eventos y no bloquea el flujo.
- `ECONOMICS_PAYOUT_LIMIT`: numero maximo de pagos Shopify recientes que se muestran en Economia. Por defecto `8`.

Estos importes salen de la factura Sendcloud `1-26-ES0024751` del 06-05-2026, sumando tarifa base y recargo de combustible aproximado. Si Sendcloud devuelve coste real al crear la etiqueta, la app usa el coste real; si no, usa esta tabla para que un pedido con envio gratis para el cliente siga teniendo coste de transporte en el margen.

La tarjeta "Pagos Shopify" usa los endpoints oficiales de Shopify Payments (`/shopify_payments/payouts.json` y `/shopify_payments/balance/transactions.json`). El token de Shopify debe tener el scope `shopify_payments_payouts` o `shopify_payments`; si no, Shopify devolvera error de permisos.

## Meta / Instagram

- `META_ACCESS_TOKEN`: token de Meta con permisos para Ads y, si se usa webhook de mensajes, para leer perfil basico de los remitentes cuando Meta lo permita.
- `META_AD_ACCOUNT_ID`: cuenta publicitaria.
- `META_PAGE_ID`: pagina conectada.
- `META_INSTAGRAM_ID`: cuenta de Instagram profesional conectada.
- `META_API_VERSION`: version Graph API. Por defecto `v21.0`.
- `META_WEBHOOK_VERIFY_TOKEN`: texto secreto que Meta pedira al verificar el webhook.
- `META_APP_SECRET`: app secret de Meta. Si esta definido, la API valida `X-Hub-Signature-256` en cada webhook entrante.
- `META_PAYMENT_LIMIT_EUR`: limite de acumulacion de facturacion Meta que quieres evitar. Por defecto `200`.
- `META_PAYMENT_WARNING_EUR`: umbral desde el que la app avisa para pagar antes de llegar al limite. Por defecto `150`.

Webhook para detectar influs desde chats de Instagram:

- Callback URL: `https://mitaller-production-4755.up.railway.app/meta/webhook`
- Verify token: el mismo valor que hayas guardado en `META_WEBHOOK_VERIFY_TOKEN`.

Cuando llega un mensaje entrante, la API crea o actualiza un `Influencer` con estado `CONTACTED`, etiqueta `instagram-webhook`, ultimo mensaje y el identificador de conversacion de Meta. Si Graph devuelve `username`, se guarda como `@usuario`; si no, se guarda temporalmente como `@ig_<id>`.

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

`FALKROSS_ARTICLE_MASTER_URL` debe apuntar a un CSV/XML de catalogo maestro con columnas equivalentes a SKU largo (`p_sku`, `sku`, `article_number`), modelo (`style_code`, `product_number`), nombre, color y talla. La API guarda esos datos en `SupplierArticle` y usa el SKU largo como `p_sku` al enviar pedidos.

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
