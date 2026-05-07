# Despliegue cloud

La app iOS necesita una API publica si debe funcionar con el ordenador del taller apagado.

Arquitectura final:

```text
iPhone / iPad -> API HTTPS cloud -> PostgreSQL cloud
                         |
                         +-> Shopify
                         +-> Sendcloud
```

## Opcion recomendada: Render

El repo ya incluye `render.yaml`, que crea:

- Servicio web `mitaller-api`.
- Base de datos PostgreSQL `mitaller-postgres`.
- Health check en `/health`.

Pasos:

1. Sube este repo a GitHub.
2. En Render, crea un Blueprint desde ese repositorio.
3. Render leera `render.yaml`.
4. Rellena las variables marcadas como secretas:
   - `JWT_SECRET`
   - `SHOPIFY_SHOP_DOMAIN`
   - `SHOPIFY_ADMIN_ACCESS_TOKEN`
   - `SHOPIFY_WEBHOOK_SECRET`
   - `SENDCLOUD_PUBLIC_KEY`
   - `SENDCLOUD_SECRET_KEY`
   - variables `SENDCLOUD_FROM_*` si no quieres usar la direccion remitente predeterminada.
5. Cuando Render cree la base de datos, copia su `DATABASE_URL`.
6. Desde tu Mac, inicializa la base cloud:

```bash
set -a; source .env; set +a
DATABASE_URL="postgresql://..." npm run prisma:push
DATABASE_URL="postgresql://..." npm run seed
```

7. Comprueba:

```bash
curl https://TU-API.onrender.com/health
```

8. En la app iOS, entra en Admin y cambia `API URL` por:

```text
https://TU-API.onrender.com
```

## Impresion de etiquetas

Shopify y Sendcloud pueden funcionar desde cloud.

La Honeywell PC42d esta conectada al taller. Un servidor cloud no puede imprimir directamente en una impresora local si el ordenador esta apagado. Para imprimir automatico hay dos opciones:

- Mantener un pequeno agente local de impresion en el taller.
- Crear la etiqueta en cloud y que la app/ordenador del taller imprima el PDF cuando este encendido.

Para el MVP, la parte critica para funcionar con el Mac apagado es mover API + PostgreSQL a cloud. La impresion automatica local queda como segundo paso.
