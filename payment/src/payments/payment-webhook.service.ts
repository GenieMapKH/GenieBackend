import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { AbaPaywayProvider } from './aba-payway.provider';
import { PaymentWebhookDto } from './dto/payment.dto';
import { PaymentStatus } from './payment-status';
import { requireMockPayments } from './mock-payment-mode';
import {
  PropertyPublishingClient,
  PublishOutcome,
} from './property/property-publishing.client';

export interface WebhookResult {
  success: boolean;
  /** True when this transaction had already been settled by an earlier webhook. */
  alreadyProcessed?: boolean;
}

/**
 * Settles a payment from the provider's webhook.
 * Safe to receive the same webhook many times: a transaction is settled once.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AbaPaywayProvider,
    private readonly property: PropertyPublishingClient,
  ) {}

  async handle(
    dto: PaymentWebhookDto,
    signature: string,
  ): Promise<WebhookResult> {
    requireMockPayments();
    if (!this.provider.verifyWebhook(dto, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { id: dto.transactionId },
    });
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    if (!transaction.propertyId || transaction.provider !== 'MOCK') {
      throw new BadRequestException('Not a mock listing transaction');
    }

    if (dto.amount !== undefined && !transaction.amount.equals(dto.amount)) {
      throw new BadRequestException('Amount does not match the transaction');
    }

    if (transaction.status !== PaymentStatus.Pending) {
      return {
        success: transaction.status === PaymentStatus.Success,
        alreadyProcessed: true,
      };
    }

    if (dto.status !== 'SUCCESS') {
      return this.settle(
        transaction.id,
        transaction.propertyId,
        PaymentStatus.Failed,
        'Draft',
      );
    }
    return this.settle(
      transaction.id,
      transaction.propertyId,
      PaymentStatus.Success,
      'Active',
    );
  }

  /**
   * Moves a Pending transaction to its final status, then tells the property
   * service to publish or release the listing. Only one concurrent webhook
   * can win the Pending -> final switch.
   *
   * If the property service cannot be told, the switch is undone and the
   * webhook fails, so the provider sends it again: a paid listing is never
   * left unpublished behind a transaction that looks settled.
   */
  private async settle(
    transactionId: string,
    propertyId: string,
    finalStatus: string,
    outcome: PublishOutcome,
  ): Promise<WebhookResult> {
    const switched = await this.prisma.paymentTransaction.updateMany({
      where: { id: transactionId, status: PaymentStatus.Pending },
      data: { status: finalStatus },
    });
    if (switched.count === 0) {
      return { success: false, alreadyProcessed: true };
    }

    try {
      await this.property.settle(propertyId, outcome);
    } catch (error) {
      await this.prisma.paymentTransaction
        .updateMany({
          where: { id: transactionId, status: finalStatus },
          data: { status: PaymentStatus.Pending },
        })
        .catch((undoError: Error) => {
          this.logger.error(
            `Transaction ${transactionId} stayed ${finalStatus} but its listing was not updated: ${undoError.message}`,
          );
        });
      throw error;
    }
    return { success: finalStatus === PaymentStatus.Success };
  }
}
