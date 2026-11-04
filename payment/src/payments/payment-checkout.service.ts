import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { AbaPaywayProvider } from './aba-payway.provider';
import { PaymentMethod } from './payment-provider.interface';
import { PaymentStatus, PUBLISH_FEE } from './payment-status';
import { PropertyPublishingClient } from './property/property-publishing.client';

/** Starts the payment that publishes a listing. */
@Injectable()
export class PaymentCheckoutService {
  private readonly logger = new Logger(PaymentCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AbaPaywayProvider,
    private readonly property: PropertyPublishingClient,
  ) {}

  async initiate(userId: string, propertyId: string, method: PaymentMethod) {
    // Only the owner may pay to publish, and only from a publishable status:
    // the property service decides, and parks the listing as Pending.
    const { previousStatus } = await this.property.begin(userId, propertyId);

    let transaction;
    try {
      transaction = await this.prisma.paymentTransaction.create({
        data: {
          userId,
          propertyId,
          provider: 'ABA_PAYWAY',
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

    const checkout = await this.provider.initiateCheckout({
      transactionId: transaction.id,
      amount: PUBLISH_FEE,
      method,
    });
    return {
      transactionId: transaction.id,
      checkoutUrl: checkout.checkoutUrl,
      abapayDeeplink: checkout.abapayDeeplink ?? null,
    };
  }
}
