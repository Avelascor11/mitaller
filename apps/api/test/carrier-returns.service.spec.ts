import { describe, expect, it, vi } from 'vitest';
import { CarrierReturnsService } from '../src/carrier-returns/carrier-returns.service';

function serviceWith(deps: {
  prisma: Record<string, any>;
  shopify?: Record<string, any>;
  klaviyo?: Record<string, any>;
  config?: Record<string, any>;
}) {
  return new CarrierReturnsService(
    deps.prisma as never,
    deps.shopify as never,
    deps.klaviyo as never,
    deps.config as never
  );
}

describe('CarrierReturnsService', () => {
  it('crea el checkout de reenvío con dirección y envío requerido', async () => {
    const prisma = {
      carrierReturn: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'carrier-1',
          orderId: 'order-1',
          orderNumber: '#9701',
          customerName: 'Cliente Test',
          customerEmail: 'cliente@test.com',
          reason: 'ABSENT',
          feeAmount: 4.95,
          invoiceUrl: null,
          draftOrderId: null
        }),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'carrier-1', ...data }))
      },
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'order-1',
          orderNumber: '#9701',
          customerName: 'Cliente Test',
          shippingAddressJson: {
            name: 'Cliente Test',
            address1: 'Calle Enredo 4',
            city: 'Santa Olalla',
            province: 'Toledo',
            zip: '45530',
            countryCodeV2: 'ES',
            phone: '600000000'
          }
        })
      }
    };
    const shopify = {
      hasCredentials: vi.fn().mockReturnValue(true),
      createDraftOrder: vi.fn().mockResolvedValue({
        id: 'gid://shopify/DraftOrder/1',
        invoiceUrl: 'https://checkout.test',
        totalPrice: 4.95
      }),
      sendDraftOrderInvoice: vi.fn()
    };
    const klaviyo = { trackCarrierReturn: vi.fn().mockResolvedValue(undefined) };
    const config = { get: vi.fn((key: string) => key === 'CARRIER_RETURN_SEND_VIA' ? 'klaviyo' : undefined) };

    await serviceWith({ prisma, shopify, klaviyo, config }).requestPayment('carrier-1');

    expect(shopify.createDraftOrder).toHaveBeenCalledWith(expect.objectContaining({
      shippingAddress: expect.objectContaining({
        address1: 'Calle Enredo 4',
        city: 'Santa Olalla',
        zip: '45530',
        countryCode: 'ES'
      }),
      lineItems: [
        expect.objectContaining({
          requiresShipping: true
        })
      ]
    }));
  });
});
