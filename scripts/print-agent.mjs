import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const API_BASE_URL = process.env.MITALLER_API_URL ?? 'https://mitaller-production-4755.up.railway.app';
const PRINTER_NAME = process.env.LABEL_PRINTER_NAME ?? 'Honeywell_PC42d';
const PAPER_SIZE = process.env.LABEL_PAPER_SIZE ?? 'Custom.100x150mm';
const POLL_SECONDS = Number(process.env.PRINT_AGENT_POLL_SECONDS ?? 15);
const PRINT_AGENT_TOKEN = process.env.PRINT_AGENT_TOKEN ?? '';
const SENDCLOUD_PUBLIC_KEY = process.env.SENDCLOUD_PUBLIC_KEY ?? '';
const SENDCLOUD_SECRET_KEY = process.env.SENDCLOUD_SECRET_KEY ?? '';
const DRY_RUN = String(process.env.PRINT_AGENT_DRY_RUN ?? 'false').toLowerCase() === 'true';

function headers(extra = {}) {
  return {
    ...extra,
    ...(PRINT_AGENT_TOKEN ? { 'x-print-agent-token': PRINT_AGENT_TOKEN } : {})
  };
}

async function getPrintQueue() {
  const response = await fetch(`${API_BASE_URL}/shipments/print-queue`, { headers: headers() });
  if (!response.ok) throw new Error(`print-queue HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function getManualQueue() {
  const response = await fetch(`${API_BASE_URL}/manual-print/queue`, { headers: headers() });
  if (!response.ok) throw new Error(`manual-print/queue HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function downloadManualLabel(id, filename) {
  const response = await fetch(`${API_BASE_URL}/manual-print/${id}/file`, { headers: headers() });
  if (!response.ok) throw new Error(`manual-print file HTTP ${response.status}: ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = join(tmpdir(), 'mitaller-print-agent');
  await mkdir(dir, { recursive: true });
  const safe = (filename || 'manual').replace(/[^a-zA-Z0-9._-]/g, '_');
  const file = join(dir, `manual-${safe}-${Date.now()}.pdf`);
  await writeFile(file, bytes);
  return file;
}

async function markManualDone(id) {
  const response = await fetch(`${API_BASE_URL}/manual-print/${id}/done`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' })
  });
  if (!response.ok) throw new Error(`manual-print done HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function downloadLabel(labelUrl, orderNumber) {
  const response = await fetch(labelUrl, { headers: sendcloudHeaders(labelUrl) });
  if (!response.ok) throw new Error(`label HTTP ${response.status}: ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = join(tmpdir(), 'mitaller-print-agent');
  await mkdir(dir, { recursive: true });
  const cleanOrder = orderNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  const file = join(dir, `${cleanOrder || 'pedido'}-${Date.now()}.pdf`);
  await writeFile(file, bytes);
  return file;
}

function sendcloudHeaders(labelUrl) {
  if (!labelUrl.includes('sendcloud') || !SENDCLOUD_PUBLIC_KEY || !SENDCLOUD_SECRET_KEY) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${SENDCLOUD_PUBLIC_KEY}:${SENDCLOUD_SECRET_KEY}`).toString('base64')}`
  };
}

const SUMATRA_CANDIDATES = [
  process.env.LABEL_PRINTER_BIN,
  'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
  'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'SumatraPDF', 'SumatraPDF.exe') : null
].filter(Boolean);

async function detectSumatra() {
  for (const candidate of SUMATRA_CANDIDATES) {
    try {
      await stat(candidate);
      return candidate;
    } catch {}
  }
  try {
    const result = await execFileAsync('where', ['SumatraPDF']);
    const first = result.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch {}
  return null;
}

async function printFile(file, orderNumber) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${orderNumber}: ${file}`);
    return { dryRun: true, file };
  }

  if (process.platform === 'win32') {
    return printWindows(file);
  }
  return printPosix(file);
}

async function printPosix(file) {
  const args = ['-d', PRINTER_NAME, '-o', 'fit-to-page', '-o', `media=${PAPER_SIZE}`, file];
  const result = await execFileAsync('lp', args);
  return {
    platform: process.platform,
    printerName: PRINTER_NAME,
    paperSize: PAPER_SIZE,
    file,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function printWindows(file) {
  const bin = await detectSumatra();
  if (!bin) {
    throw new Error(
      'No se encontró SumatraPDF. Instálalo desde https://www.sumatrapdfreader.org/download-free-pdf-viewer ' +
      'o define LABEL_PRINTER_BIN con la ruta a SumatraPDF.exe.'
    );
  }
  const settings = process.env.LABEL_PRINT_SETTINGS ?? 'noscale';
  const args = ['-print-to', PRINTER_NAME, '-print-settings', settings, '-silent', '-exit-when-done', file];
  const result = await execFileAsync(bin, args);
  return {
    platform: 'win32',
    printerName: PRINTER_NAME,
    paperSize: PAPER_SIZE,
    bin,
    settings,
    file,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

async function markPrinted(shipmentId, result) {
  const response = await fetch(`${API_BASE_URL}/shipments/${shipmentId}/mark-printed`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ result })
  });
  if (!response.ok) throw new Error(`mark-printed HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function processShipment(shipment) {
  console.log(`Printing ${shipment.orderNumber} (${shipment.id})`);
  const file = await downloadLabel(shipment.labelUrl, shipment.orderNumber);
  const printResult = await printFile(file, shipment.orderNumber);
  await markPrinted(shipment.id, printResult);
  console.log(`Printed ${shipment.orderNumber}`);
}

async function processManual(entry) {
  console.log(`Printing manual ${entry.filename} (${entry.id})`);
  const file = await downloadManualLabel(entry.id, entry.filename);
  const printResult = await printFile(file, entry.filename);
  await markManualDone(entry.id);
  console.log(`Printed manual ${entry.filename}`, printResult.dryRun ? '(dry-run)' : '');
}

async function pollOnce() {
  const [queue, manualQueue] = await Promise.all([
    getPrintQueue().catch((error) => {
      console.error('print-queue error:', error instanceof Error ? error.message : error);
      return [];
    }),
    getManualQueue().catch((error) => {
      console.error('manual-print/queue error:', error instanceof Error ? error.message : error);
      return [];
    })
  ]);
  if (!queue.length && !manualQueue.length) {
    console.log(`No pending labels. Next check in ${POLL_SECONDS}s.`);
    return;
  }
  for (const shipment of queue) {
    try {
      await processShipment(shipment);
    } catch (error) {
      console.error(`Could not print ${shipment.orderNumber}:`, error instanceof Error ? error.message : error);
    }
  }
  for (const entry of manualQueue) {
    try {
      await processManual(entry);
    } catch (error) {
      console.error(`Could not print manual ${entry.filename}:`, error instanceof Error ? error.message : error);
    }
  }
}

console.log(`Mitaller print agent started. API=${API_BASE_URL} printer=${PRINTER_NAME} dryRun=${DRY_RUN}`);

while (true) {
  try {
    await pollOnce();
  } catch (error) {
    console.error('Print agent error:', error instanceof Error ? error.message : error);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
}
