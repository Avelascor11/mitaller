# Agente de impresion

El agente de impresion corre en el ordenador del taller y permite imprimir etiquetas aunque la API viva en Railway.

Flujo:

```text
App iPhone -> Railway -> Sendcloud etiqueta creada
                         |
                         v
Ordenador taller -> print-agent -> Honeywell PC42d
```

Soportado en macOS, Linux y Windows.

## Variables

En `.env` del ordenador del taller:

```text
MITALLER_API_URL=https://mitaller-production-4755.up.railway.app
LABEL_PRINTER_NAME=
LABEL_PAPER_SIZE=Custom.100x150mm
PRINT_AGENT_POLL_SECONDS=15
PRINT_AGENT_DRY_RUN=false

# Windows
LABEL_PRINTER_BIN=
LABEL_PRINT_SETTINGS=noscale

# Sendcloud (necesario para descargar etiquetas privadas)
SENDCLOUD_PUBLIC_KEY=
SENDCLOUD_SECRET_KEY=
```

Si `LABEL_PRINTER_NAME` no esta definido, usa `Honeywell_PC42d`.

Para ver el nombre exacto de la impresora:

- macOS / Linux: `lpstat -p`
- Windows (PowerShell): `Get-Printer`

## Setup en Windows (PC del taller)

1. Instala **Node.js LTS**: <https://nodejs.org>
2. Instala **Git**: <https://git-scm.com/download/win>
3. Instala el **driver oficial Honeywell PC42d** y configura el papel a `Custom 100x150 mm` en las propiedades de la impresora.
4. Instala **SumatraPDF** (impresor PDF silencioso): <https://www.sumatrapdfreader.org/download-free-pdf-viewer>
   - El agente lo busca en `Program Files\SumatraPDF\SumatraPDF.exe`, `Program Files (x86)\SumatraPDF\SumatraPDF.exe` y `LOCALAPPDATA\SumatraPDF\SumatraPDF.exe`.
   - Si lo instalas en otra ruta, define `LABEL_PRINTER_BIN=C:\ruta\a\SumatraPDF.exe`.
5. Clona el repo y arranca:
   ```powershell
   git clone https://github.com/Avelascor11/mitaller.git
   cd mitaller
   npm install
   notepad .env   # pega las variables de arriba
   npm run print-agent
   ```

`LABEL_PRINT_SETTINGS` admite los modos de SumatraPDF: `noscale` (recomendado, usa el papel del driver), `fit`, `shrink`. El tamaño físico del papel se controla desde el driver Windows, no desde aquí.

### Arrancar al iniciar Windows

Opcion rápida con Programador de tareas:

1. Abre **Task Scheduler** → **Create Basic Task**.
2. Trigger: **When the computer starts**.
3. Action: **Start a program**.
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `scripts\print-agent.mjs`
   - Start in: `C:\ruta\a\mitaller`
4. En la última pestaña marca **Run with highest privileges** y **Run whether user is logged on or not**.

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
