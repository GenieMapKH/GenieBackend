import { Injectable, Logger } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';
import { PaidTier } from './plan-catalog';

@Injectable()
export class OrderEmailClient {
  private readonly logger = new Logger(OrderEmailClient.name);
  private readonly client = new ServiceClient(
    'authentication',
    process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
    'payment',
  );

  async send(details: {
    userId: string;
    transactionId: string;
    item: PaidTier | 'listing_publish';
    amount: number;
    periodStart: string;
    periodEnd?: string;
  }): Promise<void> {
    try {
      await this.client.call('POST', '/internal/mail/order', {
        body: details,
        timeoutMs: 30_000,
      });
    } catch (error) {
      this.logger.warn(
        `Order email for ${details.transactionId} was not sent: ${(error as Error).message}`,
      );
    }
  }
}
