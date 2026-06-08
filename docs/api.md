# API

Base local por defecto:

```text
http://localhost:3001
```

## Auth

- `POST /auth/login`
- `GET /auth/me`

## Orders

- `GET /orders`
- `GET /orders/pending-preparation`
- `GET /orders/:id`
- `PATCH /orders/:id/mark-prepared`
- `POST /orders/import-shopify`
- `POST /webhooks/shopify/orders-create`
- `POST /webhooks/shopify/orders-updated`

## Production

- `GET /production/tasks`
- `GET /production/tasks/priority-queue`
- `PATCH /production/tasks/:id/start`
- `PATCH /production/tasks/:id/complete`
- `PATCH /production/tasks/:id/block`

## Stock

- `GET /stock`
- `GET /stock/:sku`
- `POST /stock/move`
- `GET /stock/locations`

## Purchasing

- `GET /purchase-needs/today`
- `GET /purchase-needs/matrix`
- `POST /purchase-needs/generate`

## Economics

- `GET /economics/today`
- `GET /economics/month`
- `GET /economics/range?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /economics/products`
- `GET /economics/growth-control`
- `GET /economics/ads-health?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /economics/cashflow`

## Sendcloud

- `POST /shipments/:orderId/create-label`
- `GET /shipments`
- `GET /shipments/shipping-methods`
- `GET /shipments/:id`

## Recipes

- `GET /recipes`
- `POST /recipes`
- `POST /recipes/:id/components`

## Supplier

- `GET /supplier/articles`
- `GET /supplier/stock`
- `POST /supplier/import-catalog`
- `POST /supplier/sync-stock`
- `GET /supplier/purchase-orders`
- `GET /supplier/purchase-orders/:id`
- `POST /supplier/purchase-orders/daily`
- `POST /supplier/purchase-orders/:id/submit`

## Banco / PSD2

- `GET /bank/status`
- `GET /bank/institutions?country=ES`
- `POST /bank/connect`
- `GET /bank/callback`
- `POST /bank/sync`
- `GET /bank/accounts`
- `POST /bank/advisor/expense`
- `GET /bank/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /bank/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`
