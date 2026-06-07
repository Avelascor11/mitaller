import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SENDCLOUD_TIMEOUT_MS = 15000;

@Injectable()
export class SendcloudAdapter {
  constructor(private readonly config: ConfigService) {}

  hasCredentials() {
    return Boolean(this.config.get('SENDCLOUD_PUBLIC_KEY') && this.config.get('SENDCLOUD_SECRET_KEY'));
  }

  async createParcel(order: SendcloudOrderInput) {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }
    const shipmentMethodId = this.shipmentMethodIdFor(order.shippingMethod);
    if (!shipmentMethodId) {
      throw new BadRequestException('Falta metodo Sendcloud. Configura SENDCLOUD_STANDARD_SHIPMENT_METHOD_ID, SENDCLOUD_PREMIUM_SHIPMENT_METHOD_ID o SENDCLOUD_SHIPMENT_METHOD_ID con un metodo activo para el pais del pedido.');
    }

    const address = this.normalizeAddress(order.shippingAddressJson);
    const payload = {
      parcel: {
        name: address.name ?? order.customerName,
        company_name: '',
        address: address.address1,
        address_2: address.address2 ?? '',
        city: address.city,
        postal_code: address.zip,
        country: address.country,
        telephone: address.phone ?? '',
        email: order.customerEmail ?? '',
        order_number: order.orderNumber,
        weight: String(this.config.get('SENDCLOUD_DEFAULT_WEIGHT_KG') ?? '0.3'),
        request_label: true,
        shipment: { id: Number(shipmentMethodId) }
      }
    };

    const response = await this.request<SendcloudParcelResponse>('/parcels', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return { mode: 'real', parcelId: String(response.parcel.id), raw: response.parcel };
  }

  async createShipment(order: SendcloudOrderInput) {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }

    const address = this.normalizeAddress(order.shippingAddressJson);
    const addressLine = this.splitAddressLine(address.address1);
    const fromAddress = await this.resolveFromAddress();
    const shippingOptionCode = await this.resolveShippingOptionCode(order, address, fromAddress);
    const parcelItems = this.parcelItemsFor(order);
    const parcelWeight = this.parcelWeightFor(parcelItems);
    const customsInformation = this.customsInformationFor(order, address);
    const payload: Record<string, unknown> = {
      label_details: {
        mime_type: 'application/pdf',
        dpi: this.labelDpi()
      },
      to_address: {
        name: address.name ?? order.customerName,
        company_name: '',
        address_line_1: addressLine.addressLine1,
        address_line_2: address.address2 ?? '',
        house_number: addressLine.houseNumber,
        postal_code: address.zip,
        city: address.city,
        country_code: address.country,
        phone_number: address.phone ?? '',
        email: order.customerEmail ?? ''
      },
      from_address: fromAddress,
      ship_with: {
        type: 'shipping_option_code',
        properties: {
          shipping_option_code: shippingOptionCode
        }
      },
      order_number: order.orderNumber,
      total_order_price: this.totalOrderPriceFor(parcelItems),
      parcels: [
        {
          dimensions: {
            length: this.config.get<string>('SENDCLOUD_DEFAULT_LENGTH_CM') ?? '30.00',
            width: this.config.get<string>('SENDCLOUD_DEFAULT_WIDTH_CM') ?? '20.00',
            height: this.config.get<string>('SENDCLOUD_DEFAULT_HEIGHT_CM') ?? '3.00',
            unit: 'cm'
          },
          weight: {
            value: parcelWeight,
            unit: 'kg'
          },
          parcel_items: parcelItems
        }
      ],
      customs_information: customsInformation
    };

    const response = await this.requestV3<SendcloudShipmentV3Response>('/shipments/announce', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).catch((error) => {
      const details = {
        customs: Boolean(payload.customs_information),
        country: address.country,
        postalCode: address.zip,
        itemCount: parcelItems.length,
        hsCodes: parcelItems.map((item) => item.hs_code).filter(Boolean)
      };
      if (error instanceof BadGatewayException) {
        throw new BadGatewayException(`${error.message} | Sendcloud payload: ${JSON.stringify(details)}`);
      }
      throw error;
    });
    const data = response.data ?? response;
    this.assertNotUnstampedLetter(data);
    const parcel = data.parcels?.[0];
    const labelUrl = this.extractLabelUrl(data);
    const price = this.extractPrice(data, parcel);
    return {
      mode: 'real',
      shipmentId: String(data.id ?? ''),
      parcelId: String(parcel?.id ?? data.id ?? ''),
      trackingNumber: parcel?.tracking_number,
      carrier: data.carrier?.name ?? data.carrier?.code,
      labelUrl,
      cost: price?.value,
      costCurrency: price?.currency,
      raw: data
    };
  }

  private extractPrice(
    data: SendcloudShipmentV3Data,
    parcel?: SendcloudShipmentV3Parcel
  ): { value: number; currency: string } | undefined {
    const candidates: Array<{ value?: string | number; currency?: string } | undefined> = [
      parcel?.total_price,
      parcel?.price,
      data.total_price,
      data.price
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const raw = candidate.value;
      const num = typeof raw === 'number' ? raw : raw ? Number(raw) : NaN;
      if (Number.isFinite(num)) {
        return { value: num, currency: candidate.currency ?? 'EUR' };
      }
    }
    return undefined;
  }

  async createLabel(parcelId: string) {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }

    const response = await this.request<SendcloudParcelResponse>(`/parcels/${parcelId}`, { method: 'GET' });
    return {
      mode: 'real',
      parcelId,
      trackingNumber: response.parcel.tracking_number,
      carrier: response.parcel.carrier?.name,
      labelUrl: response.parcel.label?.label_printer
        ?? response.parcel.label?.normal_printer
        ?? response.parcel.label?.label
    };
  }

  async getTracking(parcelId: string) {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }
    const response = await this.request<SendcloudParcelResponse>(`/parcels/${parcelId}`, { method: 'GET' });
    return {
      parcelId,
      status: response.parcel.status?.message ?? response.parcel.status?.id ?? 'UNKNOWN',
      trackingUrl: response.parcel.tracking_url
    };
  }

  async cancelLabel(parcelId: string) {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }
    await this.request(`/parcels/${parcelId}/cancel`, { method: 'POST', body: JSON.stringify({}) });
    return { parcelId, cancelled: true, mode: 'real' };
  }

  async createReturn(input: SendcloudReturnInput) {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }

    const shippingProductCode =
      this.config.get<string>('SENDCLOUD_RETURN_SHIPPING_PRODUCT_CODE')?.trim() || 'correos:paqretorno';

    const fromCustomer = this.normalizeAddress(input.customerAddressJson);
    const fromCustomerSplit = this.splitAddressLine(fromCustomer.address1);
    const toWarehouse = await this.resolveFromAddress();

    const payload = {
      label_details: { mime_type: 'application/pdf', dpi: this.labelDpi() },
      weight: {
        value: String(this.config.get('SENDCLOUD_DEFAULT_WEIGHT_KG') ?? '0.5'),
        unit: 'kg'
      },
      from_address: {
        name: fromCustomer.name ?? input.customerName,
        company_name: '',
        address_line_1: fromCustomerSplit.addressLine1,
        address_line_2: fromCustomer.address2 ?? '',
        house_number: fromCustomerSplit.houseNumber,
        postal_code: fromCustomer.zip,
        city: fromCustomer.city,
        country_code: fromCustomer.country,
        phone_number: fromCustomer.phone ?? '',
        email: input.customerEmail
      },
      to_address: toWarehouse,
      ship_with: { shipping_product_code: shippingProductCode },
      order_number: `${(input.returnType ?? 'RETURN').toUpperCase() === 'EXCHANGE' ? 'CAMBIO' : 'DEVOLUCION'} PEDIDO ${input.orderNumber}`,
      send_tracking_emails: false
    };

    const createResponse = await this.requestV3<{ return_id?: number; parcel_id?: number }>('/returns', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const returnId = createResponse.return_id;
    const parcelId = createResponse.parcel_id;
    if (!returnId) {
      return { returnId: '', parcelId: parcelId ? String(parcelId) : undefined };
    }

    // Fetch full return details to get label URL + tracking
    const details = await this.requestV3<SendcloudReturnDetailsV3>(`/returns/${returnId}`, { method: 'GET' });

    return {
      returnId: String(returnId),
      parcelId: parcelId ? String(parcelId) : undefined,
      trackingNumber: details.tracking_number,
      carrier: details.carrier?.name ?? details.carrier?.code,
      labelUrl: details.label_url ?? details.label?.label_printer ?? details.label?.normal_printer?.[0],
      cost: details.label_cost?.value,
      costCurrency: details.label_cost?.currency
    };
  }

  /** Get the actual delivery date of a parcel by its order_number (original shipment) */
  async getDeliveryDate(orderNumber: string): Promise<Date | null> {
    if (!this.hasCredentials()) return null;
    try {
      const response = await this.request<{ parcels?: Array<{ status?: { id?: number; message?: string }; date_updated?: string; status_history?: Array<{ parent_status?: string; carrier_update_timestamp?: string }> }> }>(
        `/parcels?order_number=${encodeURIComponent(orderNumber)}`,
        { method: 'GET' }
      );
      const parcels = response.parcels ?? [];
      for (const parcel of parcels) {
        const history = parcel.status_history ?? [];
        const delivered = history.find((h) => h.parent_status === 'delivered');
        if (delivered?.carrier_update_timestamp) {
          return new Date(delivered.carrier_update_timestamp);
        }
        // fallback: status id 11 means delivered
        if (parcel.status?.id === 11 && parcel.date_updated) {
          return new Date(parcel.date_updated);
        }
      }
      return null;
    } catch (error) {
      console.error('[SendcloudAdapter] getDeliveryDate error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** Download return label PDF (proxy bytes with auth) */
  async downloadReturnLabel(parcelId: string): Promise<Buffer> {
    if (!this.hasCredentials()) throw new BadRequestException('Sendcloud no esta configurado.');
    const url = `${this.apiV3BaseURL}/parcels/${parcelId}/documents/label`;
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64')}` },
      signal: AbortSignal.timeout(SENDCLOUD_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new BadGatewayException(`Sendcloud label download error ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async listShippingMethods() {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }
    const methods: unknown[] = [];
    let next: string | undefined = `${this.apiBaseURL}/shipping_methods`;
    for (let page = 0; page < 25 && next; page += 1) {
      const response: SendcloudShippingMethodsResponse = await this.requestAbsolute<SendcloudShippingMethodsResponse>(next, { method: 'GET' });
      methods.push(...(response.shipping_methods ?? []));
      next = response.next ?? undefined;
    }
    return { mode: 'real', shippingMethods: methods };
  }

  async listSenderAddresses() {
    if (!this.hasCredentials()) {
      throw new BadRequestException('Sendcloud no esta configurado. Define SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.');
    }
    const response = await this.requestV3<SendcloudSenderAddressesResponse>('/addresses/sender-addresses', { method: 'GET' });
    return { mode: 'real', senderAddresses: response.data ?? [] };
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    return this.requestAbsolute(`${this.apiBaseURL}${path}`, init);
  }

  private async requestV3<T = unknown>(path: string, init: RequestInit): Promise<T> {
    return this.requestAbsolute(`${this.apiV3BaseURL}${path}`, init);
  }

  private async requestAbsolute<T = unknown>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64')}`,
          ...init.headers
        },
        signal: init.signal ?? AbortSignal.timeout(SENDCLOUD_TIMEOUT_MS)
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new BadGatewayException(timedOut
        ? `SendCloud tardó demasiado en responder (>${SENDCLOUD_TIMEOUT_MS / 1000}s). Inténtalo de nuevo.`
        : 'No se pudo conectar con SendCloud.');
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = this.sendcloudErrorMessage(response.status, json);
      throw new BadGatewayException(message);
    }
    return json as T;
  }

  private sendcloudErrorMessage(status: number, json: unknown) {
    const fallback = `Sendcloud API error ${status}`;
    if (!json || typeof json !== 'object') return fallback;
    const source = json as Record<string, unknown>;
    const error = source.error;
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return `Sendcloud ${status}: ${message.trim()}`;
    }
    const message = source.message;
    if (typeof message === 'string' && message.trim()) return `Sendcloud ${status}: ${message.trim()}`;
    const errors = source.errors;
    if (Array.isArray(errors) && errors.length > 0) return `Sendcloud ${status}: ${JSON.stringify(errors[0])}`;
    return `${fallback}: ${JSON.stringify(json)}`;
  }

  private normalizeAddress(raw: unknown): NormalizedAddress {
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('El pedido no tiene direccion de envio para Sendcloud');
    }
    const source = raw as Record<string, unknown>;
    const address1 = this.pickString(source, ['address1', 'address', 'street']);
    const city = this.pickString(source, ['city']);
    const zip = this.pickString(source, ['zip', 'postal_code', 'postalCode']);
    const country = this.normalizeCountryCode(this.pickString(source, ['countryCodeV2', 'country_code', 'country']));
    if (!address1 || !city || !zip || !country) {
      throw new BadRequestException('Direccion de envio incompleta para Sendcloud');
    }
    return {
      name: this.pickString(source, ['name']),
      address1,
      address2: this.pickString(source, ['address2', 'address_2']),
      city,
      zip,
      country,
      phone: this.pickString(source, ['phone', 'telephone'])
    };
  }

  private pickString(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private normalizeCountryCode(value?: string) {
    if (!value) return undefined;
    const normalized = this.normalizeText(value).trim();
    if (normalized.length === 2) return normalized.toUpperCase();
    const aliases: Record<string, string> = {
      spain: 'ES',
      espana: 'ES',
      españa: 'ES',
      france: 'FR',
      francia: 'FR',
      portugal: 'PT',
      germany: 'DE',
      alemania: 'DE',
      italy: 'IT',
      italia: 'IT',
      netherlands: 'NL',
      paisesbajos: 'NL',
      'paises bajos': 'NL'
    };
    return aliases[normalized] ?? value.trim().toUpperCase();
  }

  private splitAddressLine(address: string) {
    const trimmed = address.trim();
    const match = trimmed.match(/^(.*?)[,\s]+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/);
    if (!match) return { addressLine1: trimmed, houseNumber: '1' };
    return {
      addressLine1: match[1].trim() || trimmed,
      houseNumber: match[2].trim()
    };
  }

  private parcelItemsFor(order: SendcloudOrderInput) {
    const items = order.items ?? [];
    if (!items.length) {
      return [
        {
          description: `Pedido ${order.orderNumber}`,
          quantity: 1,
          weight: { value: 0.3, unit: 'kg' },
          price: this.defaultItemPrice(),
          hs_code: this.config.get<string>('SENDCLOUD_CUSTOMS_DEFAULT_HS_CODE')?.trim() ?? '610910',
          origin_country: this.customsOriginCountry(),
          material_content: this.config.get<string>('SENDCLOUD_CUSTOMS_MATERIAL_CONTENT')?.trim() ?? 'Cotton textile',
          intended_use: this.config.get<string>('SENDCLOUD_CUSTOMS_INTENDED_USE')?.trim() ?? 'Personal use'
        }
      ];
    }
    return items.map((item) => ({
      item_id: item.id,
      description: [item.title, item.variantTitle].filter(Boolean).join(' - '),
      quantity: item.quantity,
      weight: { value: this.weightForItem(item), unit: 'kg' },
      price: this.defaultItemPrice(),
      hs_code: this.hsCodeForItem(item),
      origin_country: this.customsOriginCountry(),
      sku: item.sku,
      product_id: item.shopifyProductId ?? undefined,
      material_content: this.config.get<string>('SENDCLOUD_CUSTOMS_MATERIAL_CONTENT')?.trim() ?? 'Cotton textile',
      intended_use: this.config.get<string>('SENDCLOUD_CUSTOMS_INTENDED_USE')?.trim() ?? 'Personal use',
      properties: {
        size: item.size ?? undefined,
        color: item.color ?? undefined
      }
    }));
  }

  private customsInformationFor(order: SendcloudOrderInput, address: NormalizedAddress) {
    return {
      invoice_number: this.invoiceNumberFor(order),
      export_reason: this.config.get<string>('SENDCLOUD_CUSTOMS_EXPORT_REASON')?.trim() ?? 'commercial_goods',
      export_type: this.config.get<string>('SENDCLOUD_CUSTOMS_EXPORT_TYPE')?.trim() ?? 'private',
      invoice_date: new Date().toISOString().slice(0, 10),
      discount_granted: { value: '0.00', currency: 'EUR' },
      freight_costs: null,
      insurance_costs: null,
      other_costs: null,
      goods_description: this.config.get<string>('SENDCLOUD_CUSTOMS_GOODS_DESCRIPTION')?.trim() ?? 'Ropa y merchandising',
      general_notes: this.customsZoneNote(address)
    };
  }

  private isSpanishCustomsZone(zip: string) {
    const compact = zip.replace(/\D/g, '');
    return /^(35|38|51|52)\d{3}$/.test(compact);
  }

  private customsZoneNote(address: NormalizedAddress) {
    if (address.country === 'ES' && this.isSpanishCustomsZone(address.zip)) {
      return 'Envio a zona espanola con tramite aduanero: Canarias, Ceuta o Melilla.';
    }
    return 'International shipment customs declaration generated by Mitaller.';
  }

  private invoiceNumberFor(order: SendcloudOrderInput) {
    const normalizedOrder = order.orderNumber.replace(/[^\dA-Za-z-]/g, '');
    return normalizedOrder ? `INV-${normalizedOrder}` : `INV-${order.id}`;
  }

  private totalOrderPriceFor(items: Array<{ quantity: number; price: { value: string; currency: string } }>) {
    const total = items.reduce((sum, item) => sum + Number(item.price.value) * item.quantity, 0);
    return { currency: 'EUR', value: total.toFixed(2) };
  }

  private parcelWeightFor(items: Array<{ quantity: number; weight: { value: number | string; unit: string } }>) {
    const configured = Number(this.config.get('SENDCLOUD_DEFAULT_WEIGHT_KG') ?? '0.3');
    const minimum = Number.isFinite(configured) && configured > 0 ? configured : 0.3;
    const declaredItemsWeight = items.reduce((sum, item) => sum + Number(item.weight.value) * item.quantity, 0);
    const total = Math.max(minimum, declaredItemsWeight);
    return total.toFixed(3);
  }

  private defaultItemPrice() {
    const configured = Number(this.config.get<string>('SENDCLOUD_CUSTOMS_DEFAULT_ITEM_VALUE_EUR') ?? '1');
    const value = Number.isFinite(configured) && configured > 0 ? configured : 1;
    return { value: value.toFixed(2), currency: 'EUR' };
  }

  private customsOriginCountry() {
    return this.config.get<string>('SENDCLOUD_CUSTOMS_ORIGIN_COUNTRY')?.trim().toUpperCase() || 'ES';
  }

  private hsCodeForItem(item: NonNullable<SendcloudOrderInput['items']>[number]) {
    const text = this.normalizeText([item.title, item.variantTitle, item.sku].filter(Boolean).join(' '));
    if (text.includes('lanyard') || text.includes('landyard') || text.includes('cordon') || text.includes('llavero')) {
      return this.config.get<string>('SENDCLOUD_CUSTOMS_LANYARD_HS_CODE')?.trim() ?? '630790';
    }
    if (text.includes('pegatina') || text.includes('sticker')) return '491199';
    if (text.includes('sudadera') || text.includes('hoodie')) return '611020';
    return this.config.get<string>('SENDCLOUD_CUSTOMS_DEFAULT_HS_CODE')?.trim() ?? '610910';
  }

  private weightForItem(item: NonNullable<SendcloudOrderInput['items']>[number]) {
    const text = this.normalizeText([item.title, item.variantTitle, item.sku].filter(Boolean).join(' '));
    if (text.includes('lanyard') || text.includes('landyard') || text.includes('cordon') || text.includes('llavero')) return 0.05;
    if (text.includes('pegatina') || text.includes('sticker')) return 0.05;
    if (text.includes('sudadera') || text.includes('hoodie')) return 0.6;
    return 0.3;
  }

  private async resolveShippingOptionCode(order: SendcloudOrderInput, toAddress: NormalizedAddress, fromAddress: SendcloudAddressPayload) {
    const explicit = this.explicitShippingOptionCodeFor(order.shippingMethod);
    if (explicit) return explicit;

    const dimensions = this.defaultDimensions();
    const weightKg = String(this.config.get('SENDCLOUD_DEFAULT_WEIGHT_KG') ?? '0.3');
    const response = await this.requestV3<SendcloudShippingOptionsResponse>('/shipping-options', {
      method: 'POST',
      body: JSON.stringify({
        from_country_code: fromAddress.country_code,
        from_postal_code: fromAddress.postal_code,
        to_country_code: toAddress.country,
        to_postal_code: toAddress.zip,
        carrier_code: 'correos',
        calculate_quotes: true,
        parcels: [
          {
            dimensions,
            weight: { value: weightKg, unit: 'kg' }
          }
        ]
      })
    });

    const options = response.data ?? [];
    const preferred = this.pickShippingOption(options, order.shippingMethod);
    const code = this.shippingOptionCodeFrom(preferred);
    if (code) return code;

    const names = options
      .slice(0, 8)
      .map((option) => this.shippingOptionText(option))
      .filter(Boolean)
      .join(' | ');
    throw new BadRequestException(
      `Sendcloud v3 no devolvio una opcion Correos valida para ${toAddress.country} ${toAddress.zip}. ` +
      `Configura SENDCLOUD_STANDARD_SHIPPING_OPTION_CODE y SENDCLOUD_PREMIUM_SHIPPING_OPTION_CODE, o revisa metodos activos. Opciones: ${names || 'ninguna'}`
    );
  }

  private explicitShippingOptionCodeFor(shippingMethod?: string | null) {
    const premium = this.isPremiumShipping(shippingMethod);
    const specific = premium
      ? this.config.get<string>('SENDCLOUD_PREMIUM_SHIPPING_OPTION_CODE')?.trim()
      : this.config.get<string>('SENDCLOUD_STANDARD_SHIPPING_OPTION_CODE')?.trim();
    return specific || this.config.get<string>('SENDCLOUD_SHIPPING_OPTION_CODE')?.trim();
  }

  private pickShippingOption(options: SendcloudShippingOption[], shippingMethod?: string | null) {
    const premium = this.isPremiumShipping(shippingMethod);
    const preferredWords = premium ? ['premium', 'express', '24'] : ['estandar', 'standard', '48', '72'];
    const usable = options.filter((option) => {
      const text = this.normalizeText(this.shippingOptionText(option));
      return text.includes('correos') && !text.includes('pudo') && !text.includes('service point') && !text.includes('letter');
    });
    return usable.find((option) => {
      const text = this.normalizeText(this.shippingOptionText(option));
      return preferredWords.some((word) => text.includes(word));
    }) ?? usable[0];
  }

  private shippingOptionCodeFrom(option?: SendcloudShippingOption) {
    if (!option) return undefined;
    const checkout = option.checkout_identifier;
    if (checkout?.type === 'shipping_option_code' && checkout.value) return checkout.value;
    return option.shipping_option_code ?? option.code ?? option.shipping_product?.code;
  }

  private shippingOptionText(option: SendcloudShippingOption) {
    return [
      option.title,
      option.internal_title,
      option.name,
      option.shipping_option_code,
      option.code,
      option.shipping_product?.code,
      option.shipping_product?.name,
      option.carrier?.code,
      option.carrier?.name
    ].filter(Boolean).join(' ');
  }

  private assertNotUnstampedLetter(data: SendcloudShipmentV3Data) {
    const text = this.normalizeText(JSON.stringify({
      carrier: data.carrier,
      ship_with: data.ship_with,
      shipping_option_code: data.shipping_option_code,
      parcels: data.parcels?.map((parcel) => ({
        tracking_number: parcel.tracking_number,
        documents: parcel.documents,
        shipping_option_code: parcel.shipping_option_code
      }))
    }));
    if (text.includes('sendcloud:letter') || text.includes('unstamped letter') || text.includes('"sendcloud"')) {
      throw new BadGatewayException('Sendcloud ha intentado crear una etiqueta tipo carta sin sello. Bloqueado para no generar etiquetas incorrectas. Revisa la opcion Correos v3 configurada.');
    }
  }

  private isPremiumShipping(shippingMethod?: string | null) {
    const normalized = this.normalizeText(shippingMethod ?? '');
    return normalized.includes('premium') || normalized.includes('express') || normalized.includes('urgente');
  }

  private normalizeText(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  private defaultDimensions() {
    return {
      length: this.config.get<string>('SENDCLOUD_DEFAULT_LENGTH_CM') ?? '30.00',
      width: this.config.get<string>('SENDCLOUD_DEFAULT_WIDTH_CM') ?? '20.00',
      height: this.config.get<string>('SENDCLOUD_DEFAULT_HEIGHT_CM') ?? '3.00',
      unit: 'cm'
    };
  }

  private labelDpi() {
    const configured = Number(this.config.get('SENDCLOUD_LABEL_DPI') ?? 72);
    return configured === 72 ? 72 : 72;
  }

  private async resolveFromAddress() {
    const configuredAddress = this.fromAddressFromEnv();
    if (configuredAddress) return configuredAddress;

    const response = await this.requestV3<SendcloudSenderAddressesResponse>('/addresses/sender-addresses', { method: 'GET' });
    const addresses = response.data ?? [];
    if (!addresses.length) {
      throw new BadRequestException('No hay direcciones remitente configuradas en Sendcloud. Crea una en Sendcloud o define SENDCLOUD_FROM_* en .env.');
    }
    const configuredId = this.config.get<string>('SENDCLOUD_SENDER_ADDRESS_ID')?.trim();
    const selected = configuredId
      ? addresses.find((address) => String(address.id) === configuredId)
      : addresses.find((address) => address.is_default || address.default || address.default_address) ?? addresses[0];

    if (!selected) {
      throw new BadRequestException(`No existe la direccion remitente Sendcloud con id ${configuredId}.`);
    }
    return this.normalizeSenderAddress(selected);
  }

  private fromAddressFromEnv() {
    const name = this.config.get<string>('SENDCLOUD_FROM_NAME')?.trim();
    const addressLine1 = this.config.get<string>('SENDCLOUD_FROM_ADDRESS_LINE_1')?.trim();
    const houseNumber = this.config.get<string>('SENDCLOUD_FROM_HOUSE_NUMBER')?.trim();
    const postalCode = this.config.get<string>('SENDCLOUD_FROM_POSTAL_CODE')?.trim();
    const city = this.config.get<string>('SENDCLOUD_FROM_CITY')?.trim();
    const countryCode = this.config.get<string>('SENDCLOUD_FROM_COUNTRY_CODE')?.trim();
    if (!name && !addressLine1 && !postalCode && !city && !countryCode) return undefined;
    if (!name || !addressLine1 || !houseNumber || !postalCode || !city || !countryCode) {
      throw new BadRequestException('Direccion remitente incompleta. Define SENDCLOUD_FROM_NAME, SENDCLOUD_FROM_ADDRESS_LINE_1, SENDCLOUD_FROM_HOUSE_NUMBER, SENDCLOUD_FROM_POSTAL_CODE, SENDCLOUD_FROM_CITY y SENDCLOUD_FROM_COUNTRY_CODE.');
    }
    return {
      name,
      company_name: this.config.get<string>('SENDCLOUD_FROM_COMPANY_NAME')?.trim() ?? '',
      address_line_1: addressLine1,
      address_line_2: this.config.get<string>('SENDCLOUD_FROM_ADDRESS_LINE_2')?.trim() ?? '',
      house_number: houseNumber,
      postal_code: postalCode,
      city,
      country_code: countryCode,
      phone_number: this.config.get<string>('SENDCLOUD_FROM_PHONE')?.trim() ?? '',
      email: this.config.get<string>('SENDCLOUD_FROM_EMAIL')?.trim() ?? ''
    };
  }

  private normalizeSenderAddress(address: SendcloudSenderAddress) {
    return {
      name: address.name ?? address.contact_name ?? address.company_name ?? 'Mitaller',
      company_name: address.company_name ?? '',
      address_line_1: address.address_line_1 ?? address.street ?? '',
      address_line_2: address.address_line_2 ?? '',
      house_number: String(address.house_number ?? ''),
      postal_code: address.postal_code ?? '',
      city: address.city ?? '',
      country_code: address.country_code ?? address.country ?? 'ES',
      phone_number: address.phone_number ?? address.telephone ?? '',
      email: address.email ?? ''
    };
  }

  private extractLabelUrl(source: unknown): string | undefined {
    const seen = new Set<unknown>();
    const visit = (value: unknown): string | undefined => {
      if (!value || seen.has(value)) return undefined;
      if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        if (normalized.includes('/documents/label') || normalized.includes('label') || normalized.endsWith('.pdf')) return value;
        return undefined;
      }
      if (typeof value !== 'object') return undefined;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const child of value) {
          const found = visit(child);
          if (found) return found;
        }
        return undefined;
      }
      const record = value as Record<string, unknown>;
      if (record.type === 'label' && typeof record.link === 'string') return record.link;
      for (const key of ['label_printer', 'normal_printer', 'label', 'link', 'url']) {
        const found = visit(record[key]);
        if (found) return found;
      }
      for (const child of Object.values(record)) {
        const found = visit(child);
        if (found) return found;
      }
      return undefined;
    };
    return visit(source);
  }

  private shipmentMethodIdFor(shippingMethod?: string | null) {
    if (this.isPremiumShipping(shippingMethod)) {
      return this.config.get<string>('SENDCLOUD_PREMIUM_SHIPMENT_METHOD_ID') || this.config.get<string>('SENDCLOUD_SHIPMENT_METHOD_ID');
    }
    return this.config.get<string>('SENDCLOUD_STANDARD_SHIPMENT_METHOD_ID') || this.config.get<string>('SENDCLOUD_SHIPMENT_METHOD_ID');
  }

  private get apiBaseURL() {
    return this.config.get<string>('SENDCLOUD_API_BASE_URL') ?? 'https://panel.sendcloud.sc/api/v2';
  }

  private get apiV3BaseURL() {
    return this.config.get<string>('SENDCLOUD_API_V3_BASE_URL') ?? 'https://panel.sendcloud.sc/api/v3';
  }

  private get publicKey() {
    return String(this.config.get('SENDCLOUD_PUBLIC_KEY') ?? '');
  }

  private get secretKey() {
    return String(this.config.get('SENDCLOUD_SECRET_KEY') ?? '');
  }
}

export interface SendcloudOrderInput {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  shippingMethod?: string | null;
  shippingAddressJson?: unknown;
  items?: Array<{
    id: string;
    shopifyProductId?: string | null;
    sku: string;
    title: string;
    variantTitle?: string | null;
    quantity: number;
    color?: string | null;
    size?: string | null;
  }>;
}

interface NormalizedAddress {
  name?: string;
  address1: string;
  address2?: string;
  city: string;
  zip: string;
  country: string;
  phone?: string;
}

interface SendcloudParcelResponse {
  parcel: {
    id: number | string;
    tracking_number?: string;
    tracking_url?: string;
    carrier?: { name?: string };
    status?: { id?: string; message?: string };
    label?: {
      label?: string;
      label_printer?: string;
      normal_printer?: string;
    };
  };
}

interface SendcloudShippingMethodsResponse {
  next?: string | null;
  shipping_methods?: unknown[];
}

interface SendcloudShipmentV3Response {
  data?: SendcloudShipmentV3Data;
  id?: string;
  carrier?: { code?: string; name?: string };
  parcels?: SendcloudShipmentV3Parcel[];
}

interface SendcloudShipmentV3Data {
  id?: string;
  carrier?: { code?: string; name?: string };
  ship_with?: unknown;
  shipping_option_code?: string;
  parcels?: SendcloudShipmentV3Parcel[];
  total_price?: { value?: string | number; currency?: string };
  price?: { value?: string | number; currency?: string };
}

interface SendcloudShipmentV3Parcel {
  id?: number | string;
  tracking_number?: string;
  shipping_option_code?: string;
  documents?: Array<{
    type?: string;
    link?: string;
  }>;
  total_price?: { value?: string | number; currency?: string };
  price?: { value?: string | number; currency?: string };
}

interface SendcloudShippingOptionsResponse {
  data?: SendcloudShippingOption[];
  message?: string | null;
}

interface SendcloudShippingOption {
  title?: string;
  internal_title?: string;
  name?: string;
  code?: string;
  shipping_option_code?: string;
  checkout_identifier?: {
    type?: string;
    value?: string;
  };
  shipping_product?: {
    code?: string;
    name?: string;
  };
  carrier?: {
    code?: string;
    name?: string;
  };
}

interface SendcloudAddressPayload {
  name: string;
  company_name: string;
  address_line_1: string;
  address_line_2: string;
  house_number: string;
  postal_code: string;
  city: string;
  country_code: string;
  phone_number: string;
  email: string;
}

interface SendcloudSenderAddressesResponse {
  data?: SendcloudSenderAddress[];
}

export interface SendcloudReturnInput {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerAddressJson: unknown;
  returnType?: string;
}

interface SendcloudReturnV3Response {
  data?: SendcloudShipmentV3Data & { id?: string };
  id?: string;
  parcels?: SendcloudShipmentV3Parcel[];
  carrier?: { code?: string; name?: string };
}

interface SendcloudReturnDetailsV3 {
  id: number;
  tracking_number?: string;
  carrier?: { code?: string; name?: string };
  label_url?: string;
  label?: {
    label_printer?: string;
    normal_printer?: string[];
  };
  label_cost?: { value?: number; currency?: string };
}

interface SendcloudSenderAddress {
  id?: string | number;
  is_default?: boolean;
  default?: boolean;
  default_address?: boolean;
  name?: string;
  contact_name?: string;
  company_name?: string;
  address_line_1?: string;
  address_line_2?: string;
  street?: string;
  house_number?: string | number;
  postal_code?: string;
  city?: string;
  country_code?: string;
  country?: string;
  phone_number?: string;
  telephone?: string;
  email?: string;
}
