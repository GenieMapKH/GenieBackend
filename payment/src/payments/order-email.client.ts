import { Injectable, Logger } from '@nestjs/common';
import { MessageBus, ServiceClient } from '@tilomnov/shared';
import { Prisma } from '@tilomnov/prisma-client';
import { PaidTier } from './plan-catalog';

@Injectable()
export class OrderEmailClient {
  private readonly logger = new Logger(OrderEmailClient.name);
  private readonly client = new ServiceClient(
    'authentication',
    process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
    'payment',
  );

  constructor(private readonly messages: MessageBus) {}
  get queued(): boolean {
    return this.messages.enabled;
  }

  async send(
    details: {
      userId: string;
      transactionId: string;
      item: PaidTier | 'listing_publish';
      amount: number;
      periodStart: string;
      periodEnd?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (this.queued) {
      await this.messages.enqueue('authentication.order-email.v1', details, {
        key: `order:${details.transactionId}`,
        tx,
      });
      return;
    }
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
