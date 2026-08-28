import { execFile } from 'node:child_process';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
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
const PACKING_LETTER_ENABLED = String(process.env.PACKING_LETTER_ENABLED ?? 'false').toLowerCase() === 'true';
const PACKING_LETTER_PRINTER_NAME = process.env.PACKING_LETTER_PRINTER_NAME ?? '';
const PACKING_LETTER_PAPER_SIZE = process.env.PACKING_LETTER_PAPER_SIZE ?? 'A4';
const PACKING_LETTER_PRINT_SETTINGS = process.env.PACKING_LETTER_PRINT_SETTINGS ?? 'fit';
const DTF_PRINT_ENABLED = String(process.env.DTF_PRINT_ENABLED ?? 'false').toLowerCase() === 'true';
const DTF_PRINTER_NAME = process.env.DTF_PRINTER_NAME ?? '';
const DTF_HOT_FOLDER = process.env.DTF_HOT_FOLDER ?? '';
const DTF_PRINT_SETTINGS = process.env.DTF_PRINT_SETTINGS ?? 'fit';

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

async function getDtfQueue() {
  if (!DTF_PRINT_ENABLED) return [];
  const response = await fetch(`${API_BASE_URL}/dtf-print/queue`, { headers: headers() });
  if (!response.ok) throw new Error(`dtf-print/queue HTTP ${response.status}: ${await response.text()}`);
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

async function downloadDtfAsset(job) {
  const response = await fetch(job.imageUrl);
  if (!response.ok) throw new Error(`dtf asset HTTP ${response.status}: ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = join(tmpdir(), 'mitaller-print-agent');
  await mkdir(dir, { recursive: true });
  const urlPath = (() => {
    try {
      return new URL(job.imageUrl).pathname;
    } catch {
      return '';
    }
  })();
  const contentType = response.headers.get('content-type') ?? '';
  const extension = extname(urlPath) || extensionFromContentType(contentType) || '.png';
  const safeSku = job.sku.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeName = job.designName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50);
  const file = join(dir, `dtf-${safeSku}-${safeName}-x${job.quantity}-${Date.now()}${extension}`);
  await writeFile(file, bytes);
  return file;
}

function extensionFromContentType(contentType) {
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('pdf')) return '.pdf';
  return null;
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

async function printPackingLetter(shipment) {
  if (!PACKING_LETTER_ENABLED) return { skipped: true, reason: 'PACKING_LETTER_ENABLED disabled' };
  if (!PACKING_LETTER_PRINTER_NAME) return { skipped: true, reason: 'PACKING_LETTER_PRINTER_NAME missing' };

  const file = await createPackingLetterPdf(shipment);
  if (DRY_RUN) {
    console.log(`[dry-run] packing letter ${shipment.orderNumber}: ${file}`);
    return { skipped: false, dryRun: true, file };
  }

  if (process.platform === 'win32') return printWindowsPackingLetter(file);
  return printPosixPackingLetter(file);
}

async function printPosixPackingLetter(file) {
  const result = await execFileAsync('lp', ['-d', PACKING_LETTER_PRINTER_NAME, '-o', 'fit-to-page', '-o', `media=${PACKING_LETTER_PAPER_SIZE}`, file]);
  return {
    skipped: false,
    platform: process.platform,
    printerName: PACKING_LETTER_PRINTER_NAME,
    paperSize: PACKING_LETTER_PAPER_SIZE,
    file,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function printWindowsPackingLetter(file) {
  const bin = await detectSumatra();
  if (!bin) {
    throw new Error(
      'No se encontró SumatraPDF. Instálalo desde https://www.sumatrapdfreader.org/download-free-pdf-viewer ' +
      'o define LABEL_PRINTER_BIN con la ruta a SumatraPDF.exe.'
    );
  }
  const result = await execFileAsync(bin, ['-print-to', PACKING_LETTER_PRINTER_NAME, '-print-settings', PACKING_LETTER_PRINT_SETTINGS, '-silent', '-exit-when-done', file]);
  return {
    skipped: false,
    platform: 'win32',
    printerName: PACKING_LETTER_PRINTER_NAME,
    bin,
    settings: PACKING_LETTER_PRINT_SETTINGS,
    file,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

async function createPackingLetterPdf(shipment) {
  const dir = join(tmpdir(), 'mitaller-print-agent');
  await mkdir(dir, { recursive: true });
  const cleanOrder = (shipment.orderNumber || 'pedido').replace(/[^a-zA-Z0-9_-]/g, '');
  const file = join(dir, `${cleanOrder || 'pedido'}-speedwear-carta.pdf`);
  const pdf = buildPackingLetterPdf(shipment);
  await writeFile(file, pdf);
  return file;
}

function buildPackingLetterPdf(shipment) {
  const width = 595.28;
  const height = 841.89;
  const content = [];
  const page = {
    width,
    height,
    stream: content,
    fonts: [
      ['/F1', 'Helvetica'],
      ['/F2', 'Helvetica-Bold'],
      ['/F3', 'Helvetica-Oblique']
    ]
  };

  drawRect(page, 42, 42, width - 84, height - 84, null, [0.12, 0.12, 0.12], 1);
  drawRect(page, 42, height - 92, width - 84, 8, [0.89, 0.09, 0.08]);
  drawText(page, 'SPEEDWEAR', 64, height - 138, 30, 'F2', [0.04, 0.04, 0.04]);
  drawText(page, `Pedido ${shipment.orderNumber || ''}`, width - 64, height - 128, 10, 'F2', [0.89, 0.09, 0.08], 'right');
  drawText(page, 'Preparado en el taller', width - 64, height - 144, 9, 'F1', [0.35, 0.35, 0.35], 'right');

  const firstName = firstCustomerName(shipment.customerName);
  drawText(page, `Hola ${firstName},`, 64, height - 205, 24, 'F2');

  const body = [
    `Tu pedido ${shipment.orderNumber || ''} ya está listo para salir del taller.`,
    'No es solo una etiqueta y una bolsa: aquí dentro va una pieza preparada una a una, con el mismo cuidado con el que nos gustaría recibirla a nosotros.',
    'Gracias por apoyar una marca pequeña que está construyendo todo esto desde cero.'
  ];

  let y = height - 245;
  for (const paragraph of body) {
    y = drawWrappedText(page, paragraph, 64, y, 468, 13, 20, 'F1', [0.13, 0.13, 0.13]) - 13;
  }

  y -= 10;
  drawRect(page, 64, y - 86, 468, 86, [0.97, 0.97, 0.96], [0.82, 0.82, 0.8], 1);
  drawText(page, 'DENTRO VA', 84, y - 28, 9, 'F2', [0.89, 0.09, 0.08]);
  const itemSummary = packingItemSummary(shipment);
  drawWrappedText(page, itemSummary, 84, y - 52, 428, 12, 17, 'F1', [0.16, 0.16, 0.16]);

  y -= 130;
  drawWrappedText(page, 'Si te gusta cuando llegue, nos ayuda muchísimo que nos etiquetes en Instagram: @speedwear.es', 64, y, 468, 13, 20, 'F2', [0.04, 0.04, 0.04]);

  y -= 72;
  drawText(page, 'Nos vemos en la pista,', 64, y, 14, 'F1');
  drawText(page, 'Angel / SpeedWear', 64, y - 34, 21, 'F3', [0.04, 0.04, 0.04]);

  drawText(page, 'THANKS FOR RIDING WITH US', 64, 96, 10, 'F2', [0.89, 0.09, 0.08]);
  drawText(page, 'speedwear.es', width - 64, 96, 10, 'F2', [0.04, 0.04, 0.04], 'right');

  return writePdfDocument(page);
}

function firstCustomerName(name) {
  const clean = String(name || '').trim();
  if (!clean || /^cliente shopify$/i.test(clean)) return 'rider';
  return clean.split(/\s+/)[0];
}

function packingItemSummary(shipment) {
  const items = Array.isArray(shipment.items) ? shipment.items : [];
  const summary = items
    .slice(0, 4)
    .map((item) => {
      const title = [item.title, item.variantTitle].filter(Boolean).join(' - ');
      return `${item.quantity || 1}x ${title || 'Producto SpeedWear'}`;
    })
    .join('  /  ');
  if (!summary) return `${shipment.itemCount || 1} articulo(s) SpeedWear preparado(s) para ti.`;
  if (items.length > 4) return `${summary}  /  +${items.length - 4} mas`;
  return summary;
}

function drawText(page, text, x, y, size = 12, font = 'F1', color = [0, 0, 0], align = 'left') {
  const safe = pdfEscape(String(text ?? ''));
  const tx = align === 'right' ? `${x} ${y} Td (${safe}) Tj` : `${x} ${y} Td (${safe}) Tj`;
  page.stream.push(
    'BT',
    `${color.map(formatNumber).join(' ')} rg`,
    `/${font} ${size} Tf`,
    align === 'right' ? `${x} ${y} Td (${safe}) Tj` : tx,
    'ET'
  );
  if (align === 'right') {
    const width = approxTextWidth(text, size);
    page.stream.splice(page.stream.length - 2, 1, `${x - width} ${y} Td (${safe}) Tj`);
  }
}

function drawWrappedText(page, text, x, y, maxWidth, size = 12, lineHeight = 16, font = 'F1', color = [0, 0, 0]) {
  const lines = wrapText(String(text ?? ''), maxWidth, size);
  let cursor = y;
  for (const line of lines) {
    drawText(page, line, x, cursor, size, font, color);
    cursor -= lineHeight;
  }
  return cursor;
}

function drawRect(page, x, y, width, height, fill = null, stroke = null, lineWidth = 1) {
  page.stream.push('q');
  if (fill) page.stream.push(`${fill.map(formatNumber).join(' ')} rg`);
  if (stroke) page.stream.push(`${stroke.map(formatNumber).join(' ')} RG`, `${lineWidth} w`);
  page.stream.push(`${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)} re`);
  page.stream.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
  page.stream.push('Q');
}

function wrapText(text, maxWidth, size) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (approxTextWidth(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function approxTextWidth(text, size) {
  return String(text ?? '').length * size * 0.52;
}

function pdfEscape(text) {
  return text
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

function writePdfDocument(page) {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesId = addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const pageId = addObject('');
  const fontIds = page.fonts.map(([, baseFont]) => addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /Encoding /WinAnsiEncoding >>`));
  const streamText = page.stream.join('\n');
  const streamId = addObject(`<< /Length ${Buffer.byteLength(streamText, 'latin1')} >>\nstream\n${streamText}\nendstream`);
  const resources = page.fonts.map(([name], index) => `${name} ${fontIds[index]} 0 R`).join(' ');
  objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${formatNumber(page.width)} ${formatNumber(page.height)}] /Resources << /Font << ${resources} >> >> /Contents ${streamId} 0 R >>`;
  objects[catalogId - 1] = '<< /Type /Catalog /Pages 2 0 R >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function sendDtfFile(file, job) {
  if (DRY_RUN) {
    console.log(`[dry-run] DTF ${job.sku} x${job.quantity}: ${file}`);
    return { dryRun: true, file, quantity: job.quantity };
  }

  if (DTF_HOT_FOLDER) {
    await mkdir(DTF_HOT_FOLDER, { recursive: true });
    const copied = [];
    for (let index = 1; index <= Math.max(1, job.quantity); index += 1) {
      const target = join(DTF_HOT_FOLDER, `${Date.now()}-${index}-${job.sku.replace(/[^a-zA-Z0-9._-]/g, '_')}${extname(file) || '.png'}`);
      await copyFile(file, target);
      copied.push(target);
    }
    return { mode: 'hot-folder', hotFolder: DTF_HOT_FOLDER, copied, quantity: job.quantity };
  }

  if (!DTF_PRINTER_NAME) {
    throw new Error('DTF_PRINT_ENABLED=true pero falta DTF_HOT_FOLDER o DTF_PRINTER_NAME.');
  }
  if (process.platform === 'win32') {
    return printWindowsDtf(file, job);
  }
  return printPosixDtf(file, job);
}

async function printPosixDtf(file, job) {
  const result = await execFileAsync('lp', ['-d', DTF_PRINTER_NAME, '-n', String(Math.max(1, job.quantity)), file]);
  return {
    platform: process.platform,
    mode: 'printer',
    printerName: DTF_PRINTER_NAME,
    quantity: job.quantity,
    file,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function printWindowsDtf(file, job) {
  const bin = await detectSumatra();
  if (!bin) {
    throw new Error(
      'No se encontró SumatraPDF. Instálalo desde https://www.sumatrapdfreader.org/download-free-pdf-viewer ' +
      'o define LABEL_PRINTER_BIN con la ruta a SumatraPDF.exe.'
    );
  }
  const results = [];
  for (let index = 0; index < Math.max(1, job.quantity); index += 1) {
    const result = await execFileAsync(bin, ['-print-to', DTF_PRINTER_NAME, '-print-settings', DTF_PRINT_SETTINGS, '-silent', '-exit-when-done', file]);
    results.push({ stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() });
  }
  return {
    platform: 'win32',
    mode: 'printer',
    printerName: DTF_PRINTER_NAME,
    bin,
    settings: DTF_PRINT_SETTINGS,
    quantity: job.quantity,
    file,
    results
  };
}

async function printPosix(file) {
  const args = ['-d', PRINTER_NAME, '-o', 'fit-to-page', '-o', `media=${PAPER_SIZE}`, '-P', '1', file];
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
  const settings = process.env.LABEL_PRINT_SETTINGS ?? 'noscale,1-1';
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

async function markDtfPrinted(jobId, result) {
  const response = await fetch(`${API_BASE_URL}/dtf-print/jobs/${jobId}/mark-printed`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ result })
  });
  if (!response.ok) throw new Error(`dtf mark-printed HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function markDtfFailed(jobId, error, result) {
  const response = await fetch(`${API_BASE_URL}/dtf-print/jobs/${jobId}/mark-failed`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ error, result })
  });
  if (!response.ok) throw new Error(`dtf mark-failed HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function beep() {
  if (DRY_RUN) return;
  try {
    if (process.platform === 'win32') {
      await execFileAsync('powershell', ['-NoProfile', '-Command', '[console]::beep(1100,150); [console]::beep(1400,150)']);
    } else if (process.platform === 'darwin') {
      await execFileAsync('afplay', ['/System/Library/Sounds/Glass.aiff']);
    } else {
      process.stdout.write('\x07');
    }
  } catch {
    process.stdout.write('\x07');
  }
}

async function processShipment(shipment) {
  console.log(`Printing ${shipment.orderNumber} (${shipment.id})`);
  const file = await downloadLabel(shipment.labelUrl, shipment.orderNumber);
  const printResult = await printFile(file, shipment.orderNumber);
  let packingLetterResult = { skipped: true, reason: 'not attempted' };
  try {
    packingLetterResult = await printPackingLetter(shipment);
  } catch (error) {
    packingLetterResult = { skipped: false, error: error instanceof Error ? error.message : String(error) };
    console.error(`Could not print packing letter ${shipment.orderNumber}:`, packingLetterResult.error);
  }
  await markPrinted(shipment.id, { ...printResult, packingLetter: packingLetterResult });
  console.log(`Printed ${shipment.orderNumber}`);
  await beep();
}

async function processManual(entry) {
  console.log(`Printing manual ${entry.filename} (${entry.id})`);
  const file = await downloadManualLabel(entry.id, entry.filename);
  const printResult = await printFile(file, entry.filename);
  await markManualDone(entry.id);
  console.log(`Printed manual ${entry.filename}`, printResult.dryRun ? '(dry-run)' : '');
  await beep();
}

async function processDtf(job) {
  console.log(`Printing DTF ${job.designName} x${job.quantity} (${job.id})`);
  const file = await downloadDtfAsset(job);
  const printResult = await sendDtfFile(file, job);
  await markDtfPrinted(job.id, printResult);
  console.log(`Printed DTF ${job.designName} x${job.quantity}`);
  await beep();
}

async function pollOnce() {
  const [queue, manualQueue, dtfQueue] = await Promise.all([
    getPrintQueue().catch((error) => {
      console.error('print-queue error:', error instanceof Error ? error.message : error);
      return [];
    }),
    getManualQueue().catch((error) => {
      console.error('manual-print/queue error:', error instanceof Error ? error.message : error);
      return [];
    }),
    getDtfQueue().catch((error) => {
      console.error('dtf-print/queue error:', error instanceof Error ? error.message : error);
      return [];
    })
  ]);
  if (!queue.length && !manualQueue.length && !dtfQueue.length) {
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
  for (const job of dtfQueue) {
    try {
      await processDtf(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not print DTF ${job.designName}:`, message);
      await markDtfFailed(job.id, message).catch((markError) => {
        console.error(`Could not mark DTF ${job.id} failed:`, markError instanceof Error ? markError.message : markError);
      });
    }
  }
}

console.log(`Mitaller print agent started. API=${API_BASE_URL} printer=${PRINTER_NAME} dryRun=${DRY_RUN} dtf=${DTF_PRINT_ENABLED ? 'on' : 'off'}`);

while (true) {
  try {
    await pollOnce();
  } catch (error) {
    console.error('Print agent error:', error instanceof Error ? error.message : error);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
}
