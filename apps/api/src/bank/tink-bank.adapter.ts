import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type TinkToken = { access: string; expiresAt: number };

@Injectable()
export class TinkBankAdapter {
  private appToken?: TinkToken;
  private userTokens = new Map<string, TinkToken>();
  private accountToUser = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  get configured() {
    return Boolean(this.config.get('TINK_CLIENT_ID') && this.config.get('TINK_CLIENT_SECRET'));
  }

  async institutions(country = 'ES') {
    if (!this.configured) return this.mockInstitutions(country);
    const token = await this.appAccessToken();
    return this.request<any[]>(`/api/v1/providers?market=${country.toUpperCase()}&capability=CHECKING_ACCOUNTS`, token);
  }

  async createRequisition(input: { institutionId: string; redirect: string; reference: string }) {
    if (!this.configured) {
      return {
        id: `mock-tink-${input.reference}`,
        link: `${input.redirect}?ref=${encodeURIComponent(input.reference)}&mock=true`,
        reference: input.reference,
        status: 'CR',
        accounts: []
      };
    }

    const appToken = await this.appAccessToken();

    const userRes = await this.request<{ user_id: string }>('/api/v1/user/create', appToken, {
      method: 'POST',
      body: JSON.stringify({ external_user_id: input.reference, locale: 'es_ES', market: 'ES' })
    });
    const userId = userRes.user_id;

    const scope = 'accounts:read,transactions:read,provider-consents:read';
    const grantRes = await this.request<{ code: string }>('/api/v1/oauth/authorization/grant/delegate', appToken, {
      method: 'POST',
      body: JSON.stringify({
        external_user_id: input.reference,
        scope,
        actor_client_id: this.config.get('TINK_CLIENT_ID'),
        id_hint: input.reference
      })
    });

    const base = this.config.get<string>('TINK_LINK_BASE_URL') ?? 'https://link.tink.com';
    const params = new URLSearchParams({
      client_id: this.config.get('TINK_CLIENT_ID')!,
      redirect_uri: input.redirect,
      authorization_code: grantRes.code,
      market: 'ES',
      locale: 'es_ES'
    });
    if (input.institutionId && input.institutionId !== 'any') {
      params.set('provider_name', input.institutionId);
    }
    const link = `${base}/1.0/authorize/?${params.toString()}`;

    return { id: userId, link, reference: input.reference, status: 'CR', accounts: [] };
  }

  async requisition(userId: string, code?: string) {
    if (!this.configured || userId.startsWith('mock-tink-')) {
      return { id: userId, status: 'LN', accounts: ['mock-tink-account'], reference: userId };
    }

    if (code) {
      const userToken = await this.exchangeCode(code);
      this.userTokens.set(userId, userToken);
    }

    const token = this.userTokens.get(userId);
    if (!token) return { id: userId, status: 'PENDING', accounts: [] };

    const res = await this.request<{ accounts: { id: string }[] }>('/data/v2/accounts', token.access);
    const accountIds = res.accounts.map(a => a.id);
    for (const id of accountIds) this.accountToUser.set(id, userId);

    return { id: userId, status: 'LN', accounts: accountIds };
  }

  async accountDetails(accountId: string) {
    if (!this.configured || accountId === 'mock-tink-account') {
      return {
        account: {
          resourceId: accountId,
          iban: 'ES0000000000000000000000',
          name: 'Cuenta taller demo',
          currency: 'EUR',
          ownerName: 'Mi Taller',
          product: 'Business account'
        }
      };
    }

    const token = this.tokenForAccount(accountId);
    const res = await this.request<any>(`/data/v2/accounts/${accountId}`, token);
    return {
      account: {
        resourceId: accountId,
        iban: res.identifiers?.iban?.iban,
        name: res.name,
        currency: res.currencyDenominatedBalance?.currencyCode ?? 'EUR',
        ownerName: res.holderName,
        product: res.type
      }
    };
  }

  async accountTransactions(accountId: string, from?: string, to?: string) {
    if (!this.configured || accountId === 'mock-tink-account') {
      return this.mockTransactions(from, to);
    }

    const token = this.tokenForAccount(accountId);
    const params = new URLSearchParams({ pageSize: '100', accountIdIn: accountId });
    if (from) params.set('bookedDateGte', from);
    if (to) params.set('bookedDateLte', to);

    const res = await this.request<any>(`/data/v2/transactions?${params.toString()}`, token);
    const booked = (res.transactions ?? []).map((t: any) => ({
      transactionId: t.id,
      bookingDate: t.dates?.booked,
      valueDate: t.dates?.value,
      transactionAmount: {
        amount: String(t.amount?.value?.unscaledValue != null
          ? t.amount.value.unscaledValue / Math.pow(10, t.amount.value.scale ?? 0)
          : 0),
        currency: t.amount?.currencyCode ?? 'EUR'
      },
      remittanceInformationUnstructured: t.descriptions?.display ?? t.descriptions?.original,
      creditorName: t.amount?.value?.unscaledValue < 0 ? t.merchantInformation?.merchantName : undefined,
      debtorName: t.amount?.value?.unscaledValue >= 0 ? t.merchantInformation?.merchantName : undefined
    }));

    return { transactions: { booked, pending: [] } };
  }

  private tokenForAccount(accountId: string): string {
    const userId = this.accountToUser.get(accountId);
    const token = userId ? this.userTokens.get(userId) : undefined;
    if (!token) throw new Error(`No token for account ${accountId} — re-sync required`);
    return token.access;
  }

  private async appAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.appToken && this.appToken.expiresAt > now + 30_000) return this.appToken.access;
    const base = this.baseUrl();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.get('TINK_CLIENT_ID')!,
      client_secret: this.config.get('TINK_CLIENT_SECRET')!,
      scope: 'user:create,authorization:grant'
    });
    const res = await fetch(`${base}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Tink app token ${res.status}: ${text}`);
    const json = JSON.parse(text);
    this.appToken = { access: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
    return this.appToken.access;
  }

  private async exchangeCode(code: string): Promise<TinkToken> {
    const now = Date.now();
    const base = this.baseUrl();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.get('TINK_CLIENT_ID')!,
      client_secret: this.config.get('TINK_CLIENT_SECRET')!
    });
    const res = await fetch(`${base}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Tink exchange code ${res.status}: ${text}`);
    const json = JSON.parse(text);
    return { access: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  }

  private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {})
      }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Tink ${res.status}: ${text}`);
    return text ? JSON.parse(text) : ({} as T);
  }

  private baseUrl() {
    return this.config.get<string>('TINK_API_BASE_URL') ?? 'https://api.tink.com';
  }

  private mockInstitutions(country: string) {
    return [
      { id: 'es-bbva-open-banking', name: 'BBVA', bic: 'BBVAESMMXXX', countries: [country.toUpperCase()] },
      { id: 'es-santander-open-banking', name: 'Santander', bic: 'BSCHESMMXXX', countries: [country.toUpperCase()] },
      { id: 'es-caixabank-open-banking', name: 'CaixaBank', bic: 'CAIXESBBXXX', countries: [country.toUpperCase()] }
    ];
  }

  private mockTransactions(from?: string, to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const date = from ?? to ?? today;
    return {
      transactions: {
        booked: [
          {
            transactionId: `mock-shopify-${date}`,
            bookingDate: date,
            valueDate: date,
            transactionAmount: { amount: '128.42', currency: 'EUR' },
            remittanceInformationUnstructured: 'SHOPIFY PAYMENTS TRANSFER',
            creditorName: 'Shopify Payments'
          },
          {
            transactionId: `mock-sendcloud-${date}`,
            bookingDate: date,
            valueDate: date,
            transactionAmount: { amount: '-18.36', currency: 'EUR' },
            remittanceInformationUnstructured: 'SENDCLOUD INVOICE',
            creditorName: 'Sendcloud'
          }
        ],
        pending: []
      }
    };
  }
}
