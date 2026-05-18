import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type GoCardlessToken = {
  access?: string;
  access_expires?: number;
  refresh?: string;
  refresh_expires?: number;
};

@Injectable()
export class GoCardlessBankAdapter {
  private token?: { access: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {}

  get configured() {
    return Boolean(this.config.get('GOCARDLESS_SECRET_ID') && this.config.get('GOCARDLESS_SECRET_KEY'));
  }

  async institutions(country = 'ES') {
    if (!this.configured) return this.mockInstitutions(country);
    return this.request<any[]>(`/institutions/?country=${encodeURIComponent(country.toUpperCase())}`);
  }

  async createRequisition(input: { institutionId: string; redirect: string; reference: string; userLanguage?: string }) {
    if (!this.configured) {
      return {
        id: `mock-req-${input.reference}`,
        link: `${input.redirect}?ref=${encodeURIComponent(input.reference)}&mock=true`,
        reference: input.reference,
        status: 'CR',
        accounts: []
      };
    }
    return this.request('/requisitions/', {
      method: 'POST',
      body: JSON.stringify({
        redirect: input.redirect,
        institution_id: input.institutionId,
        reference: input.reference,
        user_language: input.userLanguage ?? 'ES'
      })
    });
  }

  async requisition(id: string) {
    if (!this.configured || id.startsWith('mock-req-')) {
      return {
        id,
        status: 'LN',
        accounts: ['mock-bank-account'],
        reference: id.replace('mock-req-', '')
      };
    }
    return this.request<any>(`/requisitions/${id}/`);
  }

  async accountDetails(accountId: string) {
    if (!this.configured || accountId === 'mock-bank-account') {
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
    return this.request<any>(`/accounts/${accountId}/details/`);
  }

  async accountTransactions(accountId: string, from?: string, to?: string) {
    if (!this.configured || accountId === 'mock-bank-account') {
      return this.mockTransactions(from, to);
    }
    const params = new URLSearchParams();
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<any>(`/accounts/${accountId}/transactions/${query}`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const access = await this.accessToken();
    const base = this.config.get<string>('GOCARDLESS_BANK_API_BASE_URL') ?? 'https://bankaccountdata.gocardless.com/api/v2';
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`GoCardless ${response.status}: ${text}`);
    }
    return json as T;
  }

  private async accessToken() {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 30_000) return this.token.access;
    const base = this.config.get<string>('GOCARDLESS_BANK_API_BASE_URL') ?? 'https://bankaccountdata.gocardless.com/api/v2';
    const response = await fetch(`${base}/token/new/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        secret_id: this.config.get<string>('GOCARDLESS_SECRET_ID'),
        secret_key: this.config.get<string>('GOCARDLESS_SECRET_KEY')
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`GoCardless token ${response.status}: ${text}`);
    const token = JSON.parse(text) as GoCardlessToken;
    if (token.access) {
      this.token = { access: token.access, expiresAt: now + (token.access_expires ?? 86_400) * 1000 };
      return token.access;
    }
    if (!token.refresh) throw new Error('GoCardless token response missing access/refresh token');
    const refreshed = await fetch(`${base}/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh: token.refresh })
    });
    const refreshText = await refreshed.text();
    if (!refreshed.ok) throw new Error(`GoCardless refresh ${refreshed.status}: ${refreshText}`);
    const accessToken = JSON.parse(refreshText) as GoCardlessToken;
    if (!accessToken.access) throw new Error('GoCardless refresh response missing access token');
    this.token = { access: accessToken.access, expiresAt: now + (accessToken.access_expires ?? 86_400) * 1000 };
    return accessToken.access;
  }

  private mockInstitutions(country: string) {
    return [
      {
        id: 'SANDBOXFINANCE_SFIN0000',
        name: `Sandbox Finance ${country}`,
        bic: 'SFIN0000',
        transaction_total_days: '90',
        countries: [country.toUpperCase()],
        logo: ''
      }
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
