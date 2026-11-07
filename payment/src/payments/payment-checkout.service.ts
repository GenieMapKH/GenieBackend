import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { requireMockPayments } from './mock-payment-mode';
import { PaymentStatus, PUBLISH_FEE } from './payment-status';
import { PropertyPublishingClient } from './property/property-publishing.client';

/** Starts the payment that publishes a listing. */
@Injectable()
export class PaymentCheckoutService {
  private readonly logger = new Logger(PaymentCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly property: PropertyPublishingClient,
  ) {}

  async initiate(userId: string, propertyId: string, requestId: string) {
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
      return this.completeMock(previous.id, propertyId, previous.status);
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
          provider: 'MOCK',
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

    return this.completeMock(transaction.id, propertyId, transaction.status);
  }

  private async completeMock(
    transactionId: string,
    propertyId: string,
    status: string,
  ) {
    if (status === PaymentStatus.Pending) {
      // Publish first: a lost answer can safely retry this idempotent operation.
      await this.property.settle(propertyId, 'Active');
      const updated = await this.prisma.paymentTransaction.updateMany({
        where: { id: transactionId, status: PaymentStatus.Pending },
        data: { status: PaymentStatus.Success, paidAt: new Date() },
      });
      if (updated.count > 0) {
        status = PaymentStatus.Success;
      } else {
        const saved = await this.prisma.paymentTransaction.findUnique({
          where: { id: transactionId },
        });
        if (!saved) throw new NotFoundException('Transaction not found');
        status = saved.status;
      }
    }
    return {
      transactionId,
      status,
      isSimulation: true,
    };
  }

  async state(userId: string, transactionId: string) {
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { id: transactionId, userId },
      select: { id: true, status: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    return { transactionId: transaction.id, status: transaction.status };
  }
}
