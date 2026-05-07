# Agente de impresion

El agente de impresion corre en el ordenador del taller y permite imprimir etiquetas aunque la API viva en Railway.

Flujo:

```text
App iPhone -> Railway -> Sendcloud etiqueta creada
                         |
                         v
Ordenador taller -> print-agent -> Honeywell PC42d
```

## Variables

En `.env` del ordenador del taller:

```text
MITALLER_API_URL=https://mitaller-production-4755.up.railway.app
LABEL_PRINTER_NAME=
LABEL_PAPER_SIZE=Custom.100x150mm
PRINT_AGENT_POLL_SECONDS=15
PRINT_AGENT_DRY_RUN=false
```

Si `LABEL_PRINTER_NAME` no esta definido, usa `Honeywell_PC42d`.

Para ver el nombre exacto de la impresora en macOS:

```bash
lpstat -p
```

## Probar sin imprimir

```bash
PRINT_AGENT_DRY_RUN=true npm run print-agent
```

## Instalar para que arranque solo

```bash
npm run print-agent:install
```

Ver logs:

```bash
npm run print-agent:logs
```

Desinstalar:

```bash
npm run print-agent:uninstall
```

## Evitar impresiones duplicadas

Cuando una etiqueta se imprime, el agente llama a Railway y la marca como `LABEL_PRINTED` en `ActivityLog`.
La cola de impresion solo devuelve etiquetas con etiqueta creada y sin marca de impresion.
