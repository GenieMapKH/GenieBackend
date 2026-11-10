import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PaymentTransaction } from '@tilomnov/prisma-client';
import {
  PaymentProvider,
  PAYMENT_METHODS,
  PaymentMethod,
} from './payment-provider.interface';
import { PaymentStatus } from './payment-status';
import { PropertyPublishingClient } from './property/property-publishing.client';
import { OrderEmailClient } from './order-email.client';
import { monthAfter, PaidTier } from './plan-catalog';

/** Only a verified provider result may grant a subscription or publish a listing. */
@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly property: PropertyPublishingClient,
    private readonly email: OrderEmailClient,
  ) {}

  async checkout(transaction: PaymentTransaction) {
    if (transaction.status !== PaymentStatus.Pending)
      return this.result(transaction);
    this.requireProvider(transaction);
    const checkout = await this.provider.initiateCheckout(
      this.request(transaction),
    );
    const settled = await this.reconcile(transaction.id);
    return { ...checkout, ...settled };
  }

  async reconcile(transactionId: string) {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.status !== PaymentStatus.Pending)
      return this.result(transaction);
    this.requireProvider(transaction);
    const verified = await this.provider.checkTransaction(
      this.request(transaction),
    );
    if (verified.state === 'PENDING') return this.result(transaction);
    if (
      verified.transactionId !== transaction.id ||
      !Number.isFinite(verified.amount) ||
      !transaction.amount.equals(verified.amount) ||
      verified.currency !== transaction.currency
    )
      throw new BadRequestException(
        'Provider payment details do not match the transaction',
      );
    if (verified.state !== 'PAID' && verified.state !== 'FAILED')
      throw new BadRequestException('Unknown provider payment status');

    let confirmation: Parameters<OrderEmailClient['send']>[0] | undefined;
    const saved = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${transaction.userId}, 1))`;
        const current = await tx.paymentTransaction.findUniqueOrThrow({
          where: { id: transaction.id },
        });
        if (current.status !== PaymentStatus.Pending) return current;
        const paid = verified.state === 'PAID';
        const paidAt = paid ? new Date() : null;
        if (
          !current.userId ||
          (current.purpose === 'LISTING_PUBLISH' && !current.propertyId)
        ) {
          if (paid)
            this.logger.error(
              `Refund required for deleted payment target ${current.id}`,
            );
          return tx.paymentTransaction.update({
            where: { id: current.id },
            data: {
              status: paid
                ? PaymentStatus.RefundRequired
                : PaymentStatus.Failed,
              paidAt,
            },
          });
        }
        if (current.purpose === 'SUBSCRIPTION' && paidAt) {
          if (!current.subscriptionTier || !current.subscriptionPeriodEnd)
            throw new BadRequestException(
              'Missing subscription checkout period',
            );
          const active = await tx.subscription.findUnique({
            where: { userId: current.userId },
          });
          const isUpgrade =
            active != null &&
            active.currentPeriodEnd.getTime() ===
              current.subscriptionPeriodEnd.getTime();
          if (isUpgrade && current.subscriptionPeriodEnd <= paidAt) {
            this.logger.error(
              `Refund required for expired subscription upgrade ${current.id}`,
            );
            return tx.paymentTransaction.update({
              where: { id: current.id },
              data: { status: PaymentStatus.RefundRequired, paidAt },
            });
          }
          const period = {
            tier: current.subscriptionTier,
            currentPeriodStart: isUpgrade ? active.currentPeriodStart : paidAt,
            currentPeriodEnd: isUpgrade
              ? active.currentPeriodEnd
              : monthAfter(paidAt),
            transactionId: current.id,
            cancelAtPeriodEnd: isUpgrade ? active.cancelAtPeriodEnd : false,
            cancelledAt: isUpgrade ? active.cancelledAt : null,
            expiryReminderSentAt: null,
          };
          await tx.subscription.upsert({
            where: { userId: current.userId },
            create: { userId: current.userId, ...period },
            update: period,
          });
          confirmation = {
            userId: current.userId,
            transactionId: current.id,
            item: current.subscriptionTier as PaidTier,
            amount: Number(current.amount),
            periodStart: paidAt.toISOString(),
            periodEnd: period.currentPeriodEnd.toISOString(),
          };
        } else if (
          current.purpose === 'LISTING_PUBLISH' &&
          current.propertyId
        ) {
          // Idempotent remote operation: a DB rollback can safely repeat it.
          await this.property.settle(
            current.propertyId,
            paid ? 'Active' : 'Draft',
          );
          if (paidAt)
            confirmation = {
              userId: current.userId,
              transactionId: current.id,
              item: 'listing_publish',
              amount: Number(current.amount),
              periodStart: paidAt.toISOString(),
              periodEnd: monthAfter(paidAt).toISOString(),
            };
        } else if (current.purpose !== 'SUBSCRIPTION') {
          throw new BadRequestException('Unknown payment purpose');
        }
        return tx.paymentTransaction.update({
          where: { id: current.id },
          data: {
            status: paid ? PaymentStatus.Success : PaymentStatus.Failed,
            paidAt,
            ...(paidAt &&
              current.purpose === 'LISTING_PUBLISH' && {
                listingPeriodEnd: monthAfter(paidAt),
              }),
          },
        });
      },
      { timeout: 15_000 },
    );
    // shortcut: delivery is best effort; add a durable mail outbox before live billing.
    if (confirmation) await this.email.send(confirmation);
    return this.result(saved);
  }

  private requireProvider(transaction: PaymentTransaction) {
    if (transaction.provider !== this.provider.name)
      throw new BadRequestException(
        'This transaction belongs to a different payment provider',
      );
  }

  private request(transaction: PaymentTransaction) {
    const method =
      transaction.paymentMethod ??
      (transaction.purpose === 'SUBSCRIPTION' ? 'aba_pay' : 'aba_khqr');
    if (!(PAYMENT_METHODS as readonly string[]).includes(method))
      throw new BadRequestException('Unknown payment method');
    return {
      transactionId: transaction.id,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      method: method as PaymentMethod,
    };
  }

  private result(transaction: PaymentTransaction) {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      paidAt: transaction.paidAt,
      isSimulation: transaction.provider === 'MOCK',
    };
  }
}
