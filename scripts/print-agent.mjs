import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';

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
const PACKING_LETTER_LOGO_PATH = process.env.PACKING_LETTER_LOGO_PATH ?? '';
const PACKING_LETTER_TEMPLATE_PATH = process.env.PACKING_LETTER_TEMPLATE_PATH || new URL('../assets/packing-letter-template.png', import.meta.url);
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
  const templateImage = await loadPackingLetterTemplate();
  const logoImage = templateImage ? null : await loadPackingLetterLogo();
  const pdf = buildPackingLetterPdf(shipment, logoImage, templateImage);
  await writeFile(file, pdf);
  return file;
}

function buildPackingLetterPdf(shipment, logoImage = null, templateImage = null) {
  const width = 595.28;
  const height = 841.89;
  const content = [];
  const page = {
    width,
    height,
    stream: content,
    images: [
      ...(templateImage ? [['/ImBg', templateImage]] : []),
      ...(logoImage ? [['/Im1', logoImage]] : [])
    ],
    fonts: [
      ['/F1', 'Helvetica'],
      ['/F2', 'Helvetica-Bold'],
      ['/F3', 'Helvetica-Oblique']
    ]
  };

  const firstName = firstCustomerName(shipment.customerName);

  if (templateImage) {
    drawImage(page, '/ImBg', 0, 0, width, height);
  } else {
    drawRect(page, 0, 0, width, height, [1, 1, 1]);
  }

  drawRect(page, 42, 82, width - 84, 598, [1, 1, 1], [0, 0, 0], 1.4);
  drawRect(page, 56, 646, width - 112, 20, [0, 0, 0]);

  if (!templateImage && logoImage) {
    const logoW = 104;
    const logoH = logoW * logoImage.height / logoImage.width;
    drawImage(page, '/Im1', 66, height - 104, logoW, logoH);
  } else if (!templateImage) {
    drawText(page, 'SPEEDWEAR', 66, height - 84, 22, 'F2', [0, 0, 0]);
  }

  drawText(page, 'ESTO YA ESTA LISTO', width - 66, 626, 13, 'F2', [0, 0, 0], 'right');
  drawText(page, shipment.orderNumber || 'PEDIDO', width - 66, 594, 32, 'F2', [0, 0, 0], 'right');
  drawText(page, 'PREPARADO UNO A UNO', width - 66, 578, 8.6, 'F2', [0.28, 0.28, 0.28], 'right');

  drawText(page, 'HOLA', 66, 615, 18, 'F2', [0, 0, 0]);
  drawRect(page, 66, 494, width - 132, 68, [0, 0, 0]);
  drawCenteredText(page, firstName, width / 2, 516, fitFontSize(firstName, width - 168, 44), 'F2', [1, 1, 1]);
  drawWrappedText(page, 'TU PEDIDO ACABA DE SALIR DE NUESTRA MESA DE TRABAJO.', 66, 472, 420, 11, 14, 'F2', [0, 0, 0]);

  drawRect(page, 66, 410, 218, 42, [0, 0, 0]);
  drawCenteredText(page, 'HECHO EN EL TALLER', 175, 426, 10.6, 'F2', [1, 1, 1]);
  drawRect(page, 303, 410, 226, 42, null, [0, 0, 0], 1);
  drawCenteredText(page, 'LISTO PARA SALIR', 416, 426, 10.6, 'F2', [0, 0, 0]);

  const body = [
    'SPEEDWEAR NACE DE UNA IDEA SIMPLE: ROPA PARA QUIEN VIVE EL MOTOR COMO PARTE DE SU HISTORIA.',
    'NO HACEMOS MERCH RÁPIDA. PREPARAMOS PIEZAS CON IDENTIDAD, REVISADAS UNA A UNA EN EL TALLER.'
  ];

  let y = 372;
  for (const paragraph of body) {
    y = drawWrappedText(page, paragraph, 66, y, 440, 9.6, 14.5, 'F2', [0.08, 0.08, 0.08]) - 10;
  }

  drawRect(page, 66, 222, width - 132, 74, [0, 0, 0]);
  drawCenteredText(page, 'SI TE GUSTA, ETIQUÉTANOS', width / 2, 264, 14, 'F2', [1, 1, 1]);
  drawCenteredText(page, '@SPEEDWEAR.ES', width / 2, 238, 23, 'F2', [1, 1, 1]);

  drawText(page, 'NOS VEMOS EN LA PISTA,', 66, 178, 11.5, 'F2', [0, 0, 0]);
  drawText(page, 'ÁNGEL / SPEEDWEAR', 66, 146, 24, 'F2', [0, 0, 0]);

  drawText(page, 'GRACIAS POR APOYAR UNA MARCA PEQUEÑA.', 66, 104, 9.5, 'F2', [0, 0, 0]);
  drawText(page, 'SPEEDWEAR.ES', width - 66, 104, 9.5, 'F2', [0, 0, 0], 'right');

  return writePdfDocument(page);
}

function firstCustomerName(name) {
  const clean = String(name || '').trim();
  if (!clean || /^cliente shopify$/i.test(clean)) return 'RIDER';
  return clean.split(/\s+/)[0].toUpperCase();
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

function drawCenteredText(page, text, centerX, y, size = 12, font = 'F1', color = [0, 0, 0]) {
  const width = approxTextWidth(text, size);
  drawText(page, text, centerX - width / 2, y, size, font, color);
}

function fitFontSize(text, maxWidth, preferredSize) {
  let size = preferredSize;
  while (size > 14 && approxTextWidth(text, size) > maxWidth) size -= 1;
  return size;
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

function drawImage(page, name, x, y, width, height) {
  page.stream.push(
    'q',
    `${formatNumber(width)} 0 0 ${formatNumber(height)} ${formatNumber(x)} ${formatNumber(y)} cm`,
    `${name} Do`,
    'Q'
  );
}

async function loadPackingLetterLogo() {
  if (!PACKING_LETTER_LOGO_PATH) return null;
  try {
    const bytes = await readFile(PACKING_LETTER_LOGO_PATH);
    return pngToGrayscaleImage(bytes, 760);
  } catch (error) {
    console.error('Could not load packing letter logo:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function loadPackingLetterTemplate() {
  if (!PACKING_LETTER_TEMPLATE_PATH) return null;
  try {
    const bytes = await readFile(PACKING_LETTER_TEMPLATE_PATH);
    return pngToGrayscaleImage(bytes, 900);
  } catch (error) {
    console.error('Could not load packing letter template:', error instanceof Error ? error.message : error);
    return null;
  }
}

function pngToGrayscaleImage(bytes, maxWidth) {
  const png = parsePng(bytes);
  if (png.bitDepth !== 8 || ![0, 2, 4, 6].includes(png.colorType)) {
    throw new Error(`Unsupported PNG format bitDepth=${png.bitDepth} colorType=${png.colorType}`);
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[png.colorType];
  const raw = unfilterPng(png.width, png.height, channels, inflateSync(png.data));
  const bbox = pngAlphaBBox(raw, png.width, png.height, channels);
  const crop = bbox ?? { x: 0, y: 0, width: png.width, height: png.height };
  const targetWidth = Math.min(maxWidth, crop.width);
  const targetHeight = Math.max(1, Math.round(crop.height * targetWidth / crop.width));
  const pixels = Buffer.alloc(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = crop.y + Math.min(crop.height - 1, Math.floor(y * crop.height / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = crop.x + Math.min(crop.width - 1, Math.floor(x * crop.width / targetWidth));
      const source = (sy * png.width + sx) * channels;
      const r = raw[source];
      const g = channels >= 3 ? raw[source + 1] : r;
      const b = channels >= 3 ? raw[source + 2] : r;
      const a = channels === 4 ? raw[source + 3] : channels === 2 ? raw[source + 1] : 255;
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      pixels[y * targetWidth + x] = Math.round((lum * a + 255 * (255 - a)) / 255);
    }
  }
  return { width: targetWidth, height: targetHeight, data: deflateSync(pixels) };
}

function parsePng(bytes) {
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('Invalid PNG signature');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  return { width, height, bitDepth, colorType, data: Buffer.concat(idat) };
}

function unfilterPng(width, height, channels, inflated) {
  const rowBytes = width * channels;
  const output = Buffer.alloc(rowBytes * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const rowOffset = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= channels ? output[rowOffset + x - channels] : 0;
      const up = y > 0 ? output[rowOffset - rowBytes + x] : 0;
      const upLeft = y > 0 && x >= channels ? output[rowOffset - rowBytes + x - channels] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      output[rowOffset + x] = value & 0xff;
    }
    inputOffset += rowBytes;
  }
  return output;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function pngAlphaBBox(raw, width, height, channels) {
  if (![2, 4].includes(channels)) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = raw[(y * width + x) * channels + channels - 1];
      if (alpha > 12) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
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
  return String(text ?? '').length * size * 0.62;
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
  const imageIds = (page.images ?? []).map(([, image]) => addObject(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.data.length} >>\nstream\n${image.data.toString('binary')}\nendstream`));
  const streamText = page.stream.join('\n');
  const streamId = addObject(`<< /Length ${Buffer.byteLength(streamText, 'latin1')} >>\nstream\n${streamText}\nendstream`);
  const resources = page.fonts.map(([name], index) => `${name} ${fontIds[index]} 0 R`).join(' ');
  const imageResources = (page.images ?? []).map(([name], index) => `${name} ${imageIds[index]} 0 R`).join(' ');
  const xObjectResources = imageResources ? ` /XObject << ${imageResources} >>` : '';
  objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${formatNumber(page.width)} ${formatNumber(page.height)}] /Resources << /Font << ${resources} >>${xObjectResources} >> /Contents ${streamId} 0 R >>`;
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
