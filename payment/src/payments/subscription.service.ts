import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { mockPaymentsEnabled, requireMockPayments } from './mock-payment-mode';
import { monthAfter, PaidTier, PLANS } from './plan-catalog';

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async current(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      include: { transaction: { select: { provider: true } } },
    });
    if (!subscription || subscription.currentPeriodEnd <= new Date())
      return null;
    if (subscription.transaction.provider === 'MOCK' && !mockPaymentsEnabled())
      return null;
    const { transaction: _transaction, ...period } = subscription;
    return period;
  }

  async allowance(userId: string) {
    const subscription = await this.current(userId);
    return {
      listingLimit:
        PLANS[(subscription?.tier as PaidTier) ?? 'free'].listingLimit,
      expiresAt: subscription?.currentPeriodEnd ?? null,
    };
  }

  async purchase(userId: string, tier: PaidTier, requestId: string) {
    requireMockPayments();
    return this.prisma.$transaction(async (tx) => {
      // Serialize purchases and cancellation even before the first subscription exists.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 1))`;
      const previous = await tx.paymentTransaction.findUnique({
        where: { userId_requestId: { userId, requestId } },
      });
      if (previous) {
        if (
          previous.purpose !== 'SUBSCRIPTION' ||
          previous.subscriptionTier !== tier
        ) {
          throw new ConflictException(
            'This checkout reference was already used.',
          );
        }
        return {
          transactionId: previous.id,
          status: previous.status,
          isSimulation: true,
        };
      }
      // shortcut: mock purchases may replace any plan; define renewal/downgrade rules before live billing.
      const paidAt = new Date();
      const transaction = await tx.paymentTransaction.create({
        data: {
          userId,
          requestId,
          purpose: 'SUBSCRIPTION',
          subscriptionTier: tier,
          provider: 'MOCK',
          amount: PLANS[tier].amount,
          currency: 'USD',
          status: 'Success',
          paidAt,
        },
      });
      const period = {
        tier,
        currentPeriodStart: paidAt,
        currentPeriodEnd: monthAfter(paidAt),
        transactionId: transaction.id,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      };
      await tx.subscription.upsert({
        where: { userId },
        create: { userId, ...period },
        update: period,
      });
      return {
        transactionId: transaction.id,
        status: transaction.status,
        isSimulation: true,
      };
    });
  }

  async cancel(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 1))`;
      await tx.subscription.updateMany({
        where: {
          userId,
          currentPeriodEnd: { gt: new Date() },
          cancelAtPeriodEnd: false,
        },
        data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
      });
      return tx.subscription.findUnique({ where: { userId } });
    });
  }
}
