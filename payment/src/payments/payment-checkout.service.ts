import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { requireMockPayments } from './mock-payment-mode';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentMethod, PaymentProvider } from './payment-provider.interface';
import { PaymentStatus, PUBLISH_FEE } from './payment-status';
import { PropertyPublishingClient } from './property/property-publishing.client';

/** Starts the payment that publishes a listing. */
@Injectable()
export class PaymentCheckoutService {
  private readonly logger = new Logger(PaymentCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly property: PropertyPublishingClient,
    private readonly gateway: PaymentGatewayService,
    private readonly provider: PaymentProvider,
  ) {}

  async initiate(
    userId: string,
    propertyId: string,
    requestId: string,
    method: PaymentMethod = 'aba_khqr',
  ) {
    if (this.provider.name === 'MOCK' || process.env.PAYMENT_MODE !== 'live')
      requireMockPayments();
    const previous = await this.prisma.paymentTransaction.findUnique({
      where: { userId_requestId: { userId, requestId } },
    });
    if (previous) {
      if (
        previous.propertyId !== propertyId ||
        previous.purpose !== 'LISTING_PUBLISH'
      ) {
        throw new ConflictException(
          'This checkout reference was already used.',
        );
      }
      return this.gateway.checkout(previous);
    }
    // Only the owner may pay to publish, and only from a publishable status:
    // the property service decides, and parks the listing as Pending.
    const { previousStatus } = await this.property.begin(userId, propertyId);

    let transaction;
    try {
      transaction = await this.prisma.paymentTransaction.create({
        data: {
          userId,
          propertyId,
          requestId,
          provider: this.provider.name,
          paymentMethod: method,
          amount: PUBLISH_FEE,
          status: PaymentStatus.Pending,
        },
      });
    } catch (error) {
      // No transaction, so nothing will ever settle the listing: give it back.
      await this.property
        .revert(propertyId, previousStatus)
        .catch((revertError: Error) => {
          this.logger.error(
            `Listing ${propertyId} stayed Pending after a failed checkout: ${revertError.message}`,
          );
        });
      throw error;
    }

    return this.gateway.checkout(transaction);
  }

  async state(userId: string, transactionId: string) {
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { id: transactionId, userId },
      select: { id: true, status: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    return this.gateway.reconcile(transaction.id);
  }
}
