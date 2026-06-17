import { describe, expect, it, vi } from 'vitest';
import { BankService } from '../src/bank/bank.service';

function serviceWith(prisma: Record<string, any>, gocardless: Record<string, any>) {
  return new BankService(
    prisma as never,
    gocardless as never,
    { get: vi.fn(() => undefined) } as never
  );
}

describe('BankService', () => {
  it('lee y guarda el saldo si la cuenta bancaria no lo tenia cargado', async () => {
    const account = {
      id: 'bank-account-1',
      providerAccountId: 'n26-account',
      iban: 'ES1234567890',
      name: 'N26 Business',
      currency: 'EUR',
      ownerName: 'Speedwear',
      product: 'Business',
      currentBalance: null,
      availableBalance: null,
      balanceUpdatedAt: null,
      connectedAt: new Date('2026-06-01T10:00:00Z'),
      lastSyncedAt: null,
      connection: { institutionName: 'N26' }
    };
    const updated = {
      ...account,
      currentBalance: 432.1,
      availableBalance: 420,
      balanceUpdatedAt: new Date('2026-06-10T08:00:00Z')
    };
    const prisma = {
      bankAccount: {
        findMany: vi.fn().mockResolvedValue([account]),
        update: vi.fn().mockResolvedValue(updated)
      }
    };
    const gocardless = {
      accountBalances: vi.fn().mockResolvedValue({
        balances: [
          { balanceType: 'interimBooked', balanceAmount: { amount: '432.10', currency: 'EUR' } },
          { balanceType: 'interimAvailable', balanceAmount: { amount: '420.00', currency: 'EUR' } }
        ]
      })
    };

    const summary = await serviceWith(prisma, gocardless).accounts();

    expect(gocardless.accountBalances).toHaveBeenCalledWith('n26-account');
    expect(prisma.bankAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bank-account-1' },
      data: expect.objectContaining({ currentBalance: 432.1, availableBalance: 420 })
    }));
    expect(summary.balanceAvailable).toBe(true);
    expect(summary.totalBalance).toBe(432.1);
    expect(summary.accounts[0].currentBalance).toBe(432.1);
  });

  it('no devuelve cero falso si GoCardless no entrega saldo', async () => {
    const account = {
      id: 'bank-account-1',
      providerAccountId: 'n26-account',
      iban: null,
      name: 'N26 Business',
      currency: 'EUR',
      ownerName: null,
      product: null,
      currentBalance: null,
      availableBalance: null,
      balanceUpdatedAt: null,
      connectedAt: null,
      lastSyncedAt: null,
      connection: { institutionName: 'N26' }
    };
    const prisma = {
      bankAccount: {
        findMany: vi.fn().mockResolvedValue([account]),
        update: vi.fn()
      }
    };
    const gocardless = {
      accountBalances: vi.fn().mockResolvedValue({ balances: [] })
    };

    const summary = await serviceWith(prisma, gocardless).accounts();

    expect(summary.balanceAvailable).toBe(false);
    expect(summary.totalBalance).toBe(0);
    expect(summary.accounts[0].currentBalance).toBeNull();
    expect(prisma.bankAccount.update).not.toHaveBeenCalled();
  });

  it('usa saldo disponible si N26 no entrega saldo contable', async () => {
    const account = {
      id: 'bank-account-1',
      providerAccountId: 'n26-account',
      iban: null,
      name: 'N26 Business',
      currency: 'EUR',
      ownerName: null,
      product: null,
      currentBalance: null,
      availableBalance: null,
      balanceUpdatedAt: null,
      connectedAt: null,
      lastSyncedAt: null,
      connection: { institutionName: 'N26' }
    };
    const updated = {
      ...account,
      currentBalance: 812.34,
      availableBalance: 812.34,
      balanceUpdatedAt: new Date('2026-06-17T08:00:00Z')
    };
    const prisma = {
      bankAccount: {
        findMany: vi.fn().mockResolvedValue([account]),
        update: vi.fn().mockResolvedValue(updated)
      }
    };
    const gocardless = {
      accountBalances: vi.fn().mockResolvedValue({
        balances: [
          { balanceType: 'forwardAvailable', balanceAmount: { amount: '812.34', currency: 'EUR' } }
        ]
      })
    };

    const summary = await serviceWith(prisma, gocardless).accounts();

    expect(prisma.bankAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currentBalance: 812.34, availableBalance: 812.34 })
    }));
    expect(summary.balanceAvailable).toBe(true);
    expect(summary.totalBalance).toBe(812.34);
    expect(summary.accounts[0].currentBalance).toBe(812.34);
  });
});
