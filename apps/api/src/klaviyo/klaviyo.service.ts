import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KlaviyoService {
  private readonly logger = new Logger(KlaviyoService.name);
  private readonly baseUrl = 'https://a.klaviyo.com/api';

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return this.config.get<string>('KLAVIYO_API_KEY') ?? '';
  }

  private async track(metricName: string, email: string, properties: Record<string, unknown>) {
    const key = this.apiKey;
    if (!key) {
      this.logger.warn(`KLAVIYO_API_KEY not set — skipping event "${metricName}"`);
      return;
    }

    const payload = {
      data: {
        type: 'event',
        attributes: {
          metric: {
            data: {
              type: 'metric',
              attributes: { name: metricName }
            }
          },
          profile: {
            data: {
              type: 'profile',
              attributes: { email }
            }
          },
          properties
        }
      }
    };

    try {
      const res = await fetch(`${this.baseUrl}/events/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Klaviyo-API-Key ${key}`,
          revision: '2024-10-15'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`Klaviyo event "${metricName}" failed [${res.status}]: ${text}`);
      } else {
        this.logger.log(`Klaviyo event "${metricName}" sent to ${email}`);
      }
    } catch (err) {
      this.logger.error(`Klaviyo event "${metricName}" network error:`, err);
    }
  }

  /** Trigger 1: label generated (free return or after payment confirmed) */
  async trackLabelCreated(params: {
    email: string;
    customerName: string;
    orderNumber: string;
    trackingNumber?: string | null;
    carrier?: string | null;
    labelUrl?: string | null;
  }) {
    await this.track('Return Label Created', params.email, {
      CustomerName: params.customerName,
      OrderNumber: params.orderNumber,
      TrackingNumber: params.trackingNumber ?? '',
      Carrier: params.carrier ?? '',
      LabelUrl: params.labelUrl ?? ''
    });
  }

  /** Trigger 2: package received at warehouse */
  async trackPackageReceived(params: {
    email: string;
    customerName: string;
    orderNumber: string;
    receivedAt: string;
  }) {
    await this.track('Return Received', params.email, {
      CustomerName: params.customerName,
      OrderNumber: params.orderNumber,
      ReceivedAt: params.receivedAt
    });
  }

  /** Trigger 3: return approved + refund issued */
  async trackRefundApproved(params: {
    email: string;
    customerName: string;
    orderNumber: string;
    refundAmount: number;
    approvedAt: string;
  }) {
    await this.track('Return Approved', params.email, {
      CustomerName: params.customerName,
      OrderNumber: params.orderNumber,
      RefundAmount: params.refundAmount.toFixed(2),
      PaymentMethod: 'Tarjeta original',
      ApprovedAt: params.approvedAt
    });
  }
}
