import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupplierAdapter {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  orderMode() {
    return String(this.config.get('FALKROSS_ORDER_MODE') ?? 'falkross-xml').toLowerCase();
  }

  listArticles() {
    return this.prisma.supplierArticle.findMany({ orderBy: { productName: 'asc' }, take: 100 });
  }

  listStock() {
    return this.prisma.supplierStock.findMany({ orderBy: { supplierSku: 'asc' }, take: 100 });
  }

  async importCatalog(sourcePath?: string) {
    const source = sourcePath || this.config.get<string>('FALKROSS_ARTICLE_MASTER_URL');
    if (!source) {
      throw new BadRequestException('Falk & Ross no esta configurado. Define FALKROSS_ARTICLE_MASTER_URL o pasa un fichero local.');
    }
    const { text, mode } = await this.loadCatalogSource(source);
    const articles = this.parseCatalogArticles(text, mode);
    if (!articles.length) {
      throw new BadRequestException('No se pudo leer ningun articulo del catalogo Falk & Ross. Revisa el formato CSV/XML.');
    }
    for (const article of articles) {
      await this.prisma.supplierArticle.upsert({
        where: { supplier_supplierSku: { supplier: article.supplier, supplierSku: article.supplierSku } },
        create: article,
        update: article
      });
    }
    return { imported: articles.length, mode, sample: articles.slice(0, 5).map((article) => ({ supplierSku: article.supplierSku, styleCode: article.styleCode, color: article.color, size: article.size })) };
  }

  async syncStock() {
    const user = this.config.get<string>('FALKROSS_WEBSERVICE_USER') ?? '';
    const password = this.config.get<string>('FALKROSS_WEBSERVICE_PASSWORD') ?? '';
    if (!user || !password) {
      throw new BadRequestException('Stock Falk & Ross no configurado. Define FALKROSS_WEBSERVICE_USER y FALKROSS_WEBSERVICE_PASSWORD.');
    }
    const response = await fetch(this.stockCsvUrl(), {
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BadRequestException(`Falk & Ross stock ${response.status}: ${text}`);
    }
    const stocks = this.parseFalkRossStockCsv(text);
    for (const stock of stocks) {
      await this.prisma.supplierStock.upsert({
        where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: stock.supplierSku } },
        create: stock,
        update: { availableQuantity: stock.availableQuantity, lastSyncedAt: new Date() }
      });
    }
    return { synced: stocks.length, mode: 'falkross-csv' };
  }

  async submitPurchaseOrder(payload: SupplierPurchaseOrderPayload): Promise<SupplierPurchaseOrderResult> {
    const mode = this.orderMode();
    const enabled = this.config.get<string>('FALKROSS_AUTO_ORDER_ENABLED') === 'true';

    if (!enabled || mode === 'draft') {
      return {
        submitted: false,
        mode: 'draft',
        rawResponseJson: {
          message: 'Pedido generado como borrador. Define FALKROSS_AUTO_ORDER_ENABLED=true y FALKROSS_ORDER_ENDPOINT para enviar pedidos reales.',
          payload
        }
      };
    }

    if (['falkross-xml', 'falkross', 'xml'].includes(mode)) {
      return this.submitFalkRossXmlOrder(payload);
    }

    if (mode !== 'http') {
      return {
        submitted: false,
        mode,
        errorMessage: `Modo Falk & Ross no soportado todavia: ${mode}`,
        rawResponseJson: { payload }
      };
    }

    const endpoint = this.config.get<string>('FALKROSS_ORDER_ENDPOINT');
    const apiKey = this.config.get<string>('FALKROSS_ORDER_API_KEY');
    if (!endpoint) {
      throw new BadRequestException('FALKROSS_ORDER_ENDPOINT no esta configurado. No se puede enviar el pedido real a Falk & Ross.');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    const parsed = this.parseResponse(text);

    if (!response.ok) {
      return {
        submitted: false,
        mode,
        errorMessage: `Falk & Ross ${response.status}: ${text}`,
        rawResponseJson: { status: response.status, body: parsed }
      };
    }

    return {
      submitted: true,
      mode,
      externalOrderId: this.extractExternalOrderId(parsed),
      rawResponseJson: { status: response.status, body: parsed }
    };
  }

  private async submitFalkRossXmlOrder(payload: SupplierPurchaseOrderPayload): Promise<SupplierPurchaseOrderResult> {
    const endpoint = this.config.get<string>('FALKROSS_ORDER_ENDPOINT') ?? 'https://ws.falk-ross.eu/webservice/R02_000/order?format=xml';
    const user = this.config.get<string>('FALKROSS_WEBSERVICE_USER') ?? '';
    const password = this.config.get<string>('FALKROSS_WEBSERVICE_PASSWORD') ?? '';
    const customerNumber = this.config.get<string>('FALKROSS_CUSTOMER_NUMBER') ?? '';
    if (!user || !password || !customerNumber) {
      throw new BadRequestException('Falk & Ross no esta configurado. Define FALKROSS_WEBSERVICE_USER, FALKROSS_WEBSERVICE_PASSWORD y FALKROSS_CUSTOMER_NUMBER.');
    }

    const xml = this.buildFalkRossOrderXml(payload, customerNumber);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
        Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
      },
      body: xml
    });
    const text = await response.text();
    const errors = this.extractFalkRossErrors(text);

    if (!response.ok || errors.length) {
      return {
        submitted: false,
        mode: 'falkross-xml',
        errorMessage: !response.ok ? `Falk & Ross ${response.status}: ${text}` : errors.join(' | '),
        rawResponseJson: { status: response.status, xml: text, errors }
      };
    }

    return {
      submitted: true,
      mode: 'falkross-xml',
      externalOrderId: this.extractFalkRossOrderId(text),
      rawResponseJson: { status: response.status, xml: text }
    };
  }

  private buildFalkRossOrderXml(payload: SupplierPurchaseOrderPayload, customerNumber: string) {
    const requestDateTime = this.formatFalkRossDate(new Date());
    const shippingMethod = this.config.get<string>('FALKROSS_SHIPPING_METHOD') ?? '0';
    const partialShipment = this.config.get<string>('FALKROSS_PARTIAL_SHIPMENT') ?? 'true';
    const deliveryAddress = this.falkRossDeliveryAddressXml();
    const products = payload.lines.map((line, index) => `
      <product>
        <p_sku>${this.xmlText(line.supplierSku)}</p_sku>
        <p_lineref><![CDATA[${this.cdata(`${payload.orderNumber}-${index + 1}`)}]]></p_lineref>
        <p_quantity><pq_ordered>${line.quantity}</pq_ordered></p_quantity>
      </product>`).join('');

    return `<?xml version="1.0" encoding="utf-8"?>
<order>
  <request_date_time>${requestDateTime}</request_date_time>
  <customers_number><cn_value>${this.xmlText(customerNumber)}</cn_value></customers_number>
  <shipping_method><sm_value>${this.xmlText(shippingMethod)}</sm_value></shipping_method>
  <partial_shipment><ps_value>${this.xmlText(partialShipment)}</ps_value></partial_shipment>
  <order_reference><or_value><![CDATA[${this.cdata(payload.orderNumber)}]]></or_value></order_reference>
  <order_note><on_value><![CDATA[${this.cdata(payload.orderNote ?? `Mitaller automatic order ${payload.orderNumber}`)}]]></on_value></order_note>
  ${deliveryAddress}
  <product_list>${products}
  </product_list>
</order>`;
  }

  private falkRossDeliveryAddressXml() {
    const different = this.config.get<string>('FALKROSS_DELIVERY_ADDRESS_DIFFERENT') === 'true';
    if (!different) {
      return '<delivery_address><da_is_different><da_value>false</da_value></da_is_different></delivery_address>';
    }
    const get = (key: string) => this.config.get<string>(key) ?? '';
    return `<delivery_address>
    <da_is_different><da_value>true</da_value></da_is_different>
    <da_lastname><da_value><![CDATA[${this.cdata(get('FALKROSS_DELIVERY_LASTNAME'))}]]></da_value></da_lastname>
    <da_firstname><da_value><![CDATA[${this.cdata(get('FALKROSS_DELIVERY_FIRSTNAME'))}]]></da_value></da_firstname>
    <da_company><da_value><![CDATA[${this.cdata(get('FALKROSS_DELIVERY_COMPANY'))}]]></da_value></da_company>
    <da_street_address><da_value><![CDATA[${this.cdata(get('FALKROSS_DELIVERY_STREET'))}]]></da_value></da_street_address>
    <da_city><da_value><![CDATA[${this.cdata(get('FALKROSS_DELIVERY_CITY'))}]]></da_value></da_city>
    <da_postcode><da_value>${this.xmlText(get('FALKROSS_DELIVERY_POSTCODE'))}</da_value></da_postcode>
    <da_country_code><da_value>${this.xmlText(get('FALKROSS_DELIVERY_COUNTRY_CODE') || 'ES')}</da_value></da_country_code>
  </delivery_address>`;
  }

  private extractFalkRossErrors(xml: string) {
    const errors: string[] = [];
    const messagePattern = /<([a-z_]+_err_msg)>\s*(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?\s*<\/\1>/gi;
    for (const match of xml.matchAll(messagePattern)) {
      const message = match[2]?.trim();
      if (message) errors.push(message);
    }
    return errors;
  }

  private extractFalkRossOrderId(xml: string) {
    const patterns = [
      /<(?:webservice_order_number|order_number|ordernumber|belegnummer|bestellnummer)[^>]*>\s*(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?\s*<\/[^>]+>/i,
      /<[^>]*(?:number|id)[^>]*>\s*(?:<!\[CDATA\[)?([A-Z0-9-]{4,})(?:\]\]>)?\s*<\/[^>]+>/i
    ];
    for (const pattern of patterns) {
      const value = xml.match(pattern)?.[1]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  private parseResponse(text: string) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private extractExternalOrderId(response: unknown) {
    if (!response || typeof response !== 'object') return undefined;
    const obj = response as Record<string, unknown>;
    const id = obj.orderId ?? obj.order_id ?? obj.id ?? obj.reference;
    return id == null ? undefined : String(id);
  }

  private stockCsvUrl() {
    return this.config.get<string>('FALKROSS_STOCK_CSV_URL') ?? 'https://ws.falk-ross.eu/webservice/R01_000/stockinfo/falkross_de.csv';
  }

  private async loadCatalogSource(source: string) {
    if (/^https?:\/\//i.test(source)) {
      const user = this.config.get<string>('FALKROSS_WEBSERVICE_USER') ?? '';
      const password = this.config.get<string>('FALKROSS_WEBSERVICE_PASSWORD') ?? '';
      const response = await fetch(source, {
        headers: user && password ? { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` } : {}
      });
      const text = await response.text();
      if (!response.ok) {
        throw new BadRequestException(`Catalogo Falk & Ross ${response.status}: ${text}`);
      }
      return { text, mode: source.toLowerCase().includes('.xml') ? 'falkross-xml' : 'falkross-csv' };
    }

    const buffer = await readFile(source);
    if (source.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('Importa primero el CSV/XML del ZIP. El servidor no descomprime ZIP automaticamente en produccion.');
    }
    return { text: buffer.toString('utf8'), mode: source.toLowerCase().endsWith('.xml') ? 'local-xml' : 'local-csv' };
  }

  private parseCatalogArticles(text: string, mode: string) {
    const articles = mode.includes('xml')
      ? this.parseCatalogXml(text, mode)
      : this.parseCatalogCsv(text, mode);
    const deduped = new Map<string, CatalogArticleInput>();
    for (const article of articles) {
      if (!article.supplierSku) continue;
      deduped.set(article.supplierSku, article);
    }
    return [...deduped.values()];
  }

  private parseCatalogCsv(text: string, mode: string) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const delimiter = this.detectDelimiter(lines[0]);
    const headers = this.splitCsvLine(lines[0], delimiter).map((cell) => this.normalizeHeader(cell));
    const hasHeader = headers.some((header) => ['sku', 'psku', 'suppliersku', 'artikelnr', 'artikelnummer', 'productnumber', 'stylecode', 'color', 'colour', 'size'].includes(header));
    const rows = hasHeader ? lines.slice(1) : lines;

    return rows.map((line) => {
      const cells = this.splitCsvLine(line, delimiter);
      const get = (candidates: string[]) => this.pickCatalogCell(cells, headers, candidates, hasHeader);
      const supplierSku = get(['sku', 'psku', 'p_sku', 'suppliersku', 'article', 'articlenumber', 'article_number', 'artikelnr', 'artikelnummer', 'itemnumber']);
      const styleCode = get(['style', 'stylecode', 'style_code', 'suppliercode', 'supplier_code', 'productno', 'productnumber', 'product_number', 'model', 'code', 'codigo', 'codigoproveedor']);
      const productName = get(['name', 'productname', 'product_name', 'description', 'bezeichnung', 'artikelname', 'title']) || cells.join(' ');
      const color = get(['color', 'colour', 'farbe', 'colorname', 'colourname']);
      const size = get(['size', 'groesse', 'größe', 'talla']);
      const ean = get(['ean', 'barcode', 'gtin']);
      const purchasePrice = this.pickPrice(get(['purchaseprice', 'purchase_price', 'price', 'preis', 'netprice', 'net_price']));
      const weightGrams = this.pickInteger(get(['weight', 'weightgrams', 'weight_grams', 'gewicht']));
      const packQuantity = this.pickInteger(get(['packquantity', 'pack_quantity', 'pack', 'packagequantity']));
      const cartonQuantity = this.pickInteger(get(['cartonquantity', 'carton_quantity', 'carton']));
      return this.catalogArticle({ supplierSku, styleCode, productName, color, size, ean, purchasePrice, weightGrams, packQuantity, cartonQuantity, rawDataJson: { mode, row: cells } });
    }).filter((article): article is CatalogArticleInput => Boolean(article?.supplierSku));
  }

  private parseCatalogXml(text: string, mode: string) {
    const blocks = [...text.matchAll(/<(?:article|product|item|variant)\b[^>]*>([\s\S]*?)<\/(?:article|product|item|variant)>/gi)].map((match) => match[1]);
    const rows = blocks.length ? blocks : [text];
    return rows.map((block) => {
      const get = (names: string[]) => this.pickXmlValue(block, names);
      const supplierSku = get(['p_sku', 'sku', 'supplierSku', 'article_number', 'articlenr', 'artikelnummer']);
      const styleCode = get(['style_code', 'styleCode', 'style', 'product_number', 'productNumber', 'supplier_code', 'model']);
      const productName = get(['product_name', 'productName', 'name', 'description', 'title']) || this.stripXml(block).slice(0, 160);
      const color = get(['color', 'colour', 'farbe']);
      const size = get(['size', 'groesse', 'talla']);
      const ean = get(['ean', 'barcode', 'gtin']);
      const purchasePrice = this.pickPrice(get(['purchase_price', 'purchasePrice', 'price', 'net_price']));
      const weightGrams = this.pickInteger(get(['weight_grams', 'weight', 'gewicht']));
      const packQuantity = this.pickInteger(get(['pack_quantity', 'packQuantity', 'pack']));
      const cartonQuantity = this.pickInteger(get(['carton_quantity', 'cartonQuantity', 'carton']));
      return this.catalogArticle({ supplierSku, styleCode, productName, color, size, ean, purchasePrice, weightGrams, packQuantity, cartonQuantity, rawDataJson: { mode } });
    }).filter((article): article is CatalogArticleInput => Boolean(article?.supplierSku));
  }

  private catalogArticle(input: {
    supplierSku?: string | null;
    styleCode?: string | null;
    productName?: string | null;
    color?: string | null;
    size?: string | null;
    ean?: string | null;
    purchasePrice?: string | null;
    weightGrams?: number | null;
    packQuantity?: number | null;
    cartonQuantity?: number | null;
    rawDataJson: unknown;
  }): CatalogArticleInput | null {
    const supplierSku = input.supplierSku?.trim();
    if (!supplierSku) return null;
    return {
      supplier: 'FALK_ROSS',
      supplierSku,
      styleCode: input.styleCode?.trim() || this.inferStyleCode(input.productName ?? ''),
      brand: this.inferBrand(input.productName ?? ''),
      productName: input.productName?.trim() || supplierSku,
      color: input.color?.trim() || null,
      size: input.size?.trim() || null,
      ean: input.ean?.trim() || null,
      purchasePrice: input.purchasePrice ?? null,
      weightGrams: input.weightGrams ?? null,
      packQuantity: input.packQuantity ?? null,
      cartonQuantity: input.cartonQuantity ?? null,
      rawDataJson: input.rawDataJson as Prisma.InputJsonValue
    };
  }

  private pickCatalogCell(cells: string[], headers: string[], candidates: string[], hasHeader: boolean) {
    if (hasHeader) {
      const normalizedCandidates = candidates.map((candidate) => this.normalizeHeader(candidate));
      const index = headers.findIndex((header) => normalizedCandidates.includes(header));
      return index >= 0 ? cells[index]?.replace(/^"|"$/g, '').trim() || null : null;
    }
    const joined = cells.join(' ');
    if (candidates.some((candidate) => ['sku', 'psku', 'suppliersku', 'article'].includes(this.normalizeHeader(candidate)))) {
      return cells.find((cell) => /^\d{6,}$/.test(cell.replace(/\D/g, '')))?.trim() ?? null;
    }
    if (candidates.some((candidate) => ['style', 'stylecode', 'productnumber', 'suppliercode'].includes(this.normalizeHeader(candidate)))) {
      return joined.match(/\b(TG002|WG005|2000|032\.?42|102\.?09|237\.?42|240\.?42|290\.?09)\b/i)?.[1] ?? null;
    }
    return null;
  }

  private pickXmlValue(block: string, names: string[]) {
    for (const name of names) {
      const pattern = new RegExp(`<${name}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${name}>`, 'i');
      const value = block.match(pattern)?.[1];
      if (value?.trim()) return this.stripXml(value).trim();
    }
    return null;
  }

  private stripXml(value: string) {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private pickPrice(value: string | null) {
    if (!value) return null;
    const parsed = Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
  }

  private pickInteger(value: string | null) {
    if (!value) return null;
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }

  private inferStyleCode(value: string) {
    return value.match(/\b(TG002|WG005|2000|032\.?42|102\.?09|237\.?42|240\.?42|290\.?09)\b/i)?.[1] ?? null;
  }

  private inferBrand(value: string) {
    if (/B&C/i.test(value)) return 'B&C';
    return 'FalkRoss';
  }

  private parseFalkRossStockCsv(text: string) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const delimiter = this.detectDelimiter(lines[0]);
    const first = this.splitCsvLine(lines[0], delimiter).map((cell) => this.normalizeHeader(cell));
    const hasHeader = first.some((cell) => ['sku', 'artikelnr', 'artikelnummer', 'article', 'stock', 'bestand', 'available'].includes(cell));
    const headers = hasHeader ? first : [];
    const rows = hasHeader ? lines.slice(1) : lines;
    const skuIndex = this.findHeaderIndex(headers, ['sku', 'artikelnr', 'artikelnummer', 'article', 'article_number', 'p_sku']);
    const stockIndex = this.findHeaderIndex(headers, ['stock', 'bestand', 'available', 'availablequantity', 'quantity', 'qty', 'lagerbestand']);
    const stocks = new Map<string, number>();

    for (const line of rows) {
      const cells = this.splitCsvLine(line, delimiter);
      const supplierSku = this.pickSupplierSku(cells, skuIndex);
      const availableQuantity = this.pickStockQuantity(cells, stockIndex);
      if (!supplierSku || availableQuantity == null) continue;
      stocks.set(supplierSku, availableQuantity);
    }

    return [...stocks].map(([supplierSku, availableQuantity]) => ({
      supplier: 'FALK_ROSS',
      supplierSku,
      availableQuantity
    }));
  }

  private detectDelimiter(line: string) {
    const candidates = [';', ',', '\t', '|'];
    return candidates
      .map((delimiter) => ({ delimiter, count: line.split(delimiter).length }))
      .sort((left, right) => right.count - left.count)[0].delimiter;
  }

  private splitCsvLine(line: string, delimiter: string) {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  private normalizeHeader(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '');
  }

  private findHeaderIndex(headers: string[], candidates: string[]) {
    return headers.findIndex((header) => candidates.includes(header));
  }

  private pickSupplierSku(cells: string[], skuIndex: number) {
    const value = skuIndex >= 0 ? cells[skuIndex] : cells.find((cell) => /^\d{6,}$/.test(cell.replace(/\D/g, '')));
    return value?.replace(/^"|"$/g, '').trim() || null;
  }

  private pickStockQuantity(cells: string[], stockIndex: number) {
    const value = stockIndex >= 0
      ? cells[stockIndex]
      : [...cells].reverse().find((cell) => /^-?\d+$/.test(cell.replace(/\s/g, '')));
    if (value == null) return null;
    const quantity = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : null;
  }

  private formatFalkRossDate(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private xmlText(value: string) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private cdata(value: string) {
    return value.replace(/\]\]>/g, ']]]]><![CDATA[>');
  }
}

export interface SupplierPurchaseOrderPayload {
  supplier: string;
  orderNumber: string;
  requestedAt: string;
  source: string;
  orderNote?: string;
  lines: Array<{
    supplierSku: string;
    name: string;
    quantity: number;
    color?: string;
    size?: string;
  }>;
}

export interface SupplierPurchaseOrderResult {
  submitted: boolean;
  mode: string;
  externalOrderId?: string;
  errorMessage?: string;
  rawResponseJson: unknown;
}

interface CatalogArticleInput {
  supplier: string;
  supplierSku: string;
  styleCode: string | null;
  brand: string;
  productName: string;
  color: string | null;
  size: string | null;
  ean: string | null;
  purchasePrice: string | null;
  weightGrams: number | null;
  packQuantity: number | null;
  cartonQuantity: number | null;
  rawDataJson: Prisma.InputJsonValue;
}
