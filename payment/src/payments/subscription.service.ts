import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { requireMockPayments } from './mock-payment-mode';
import {
  BillingPeriod,
  listingExpiry,
  monthAfter,
  PaidTier,
  planPrice,
  PLANS,
} from './plan-catalog';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentMethod, PaymentProvider } from './payment-provider.interface';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayService,
    private readonly provider: PaymentProvider,
  ) {}

  async current(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    if (!subscription || subscription.currentPeriodEnd <= new Date())
      return null;
    return subscription;
  }

  async allowance(userId: string) {
    const subscription = await this.current(userId);
    return {
      listingLimit:
        subscription?.listingLimit ??
        PLANS[(subscription?.tier as PaidTier) ?? 'free'].listingLimit,
      expiresAt: subscription?.currentPeriodEnd ?? null,
    };
  }

  async publishingEntitlements(userId: string) {
    const allowance = await this.allowance(userId);
    const paid = await this.prisma.paymentTransaction.findMany({
      where: {
        userId,
        purpose: 'LISTING_PUBLISH',
        // A pending payment may have published remotely before its final DB commit failed.
        status: { in: ['Success', 'Pending'] },
        propertyId: { not: null },
      },
      select: {
        propertyId: true,
        status: true,
        listingPeriodEnd: true,
        createdAt: true,
      },
    });
    const now = new Date();
    const protectedIds = new Set(
      paid
        .filter((row) =>
          row.status === 'Pending'
            ? listingExpiry(row.createdAt) > now
            : row.listingPeriodEnd && row.listingPeriodEnd > now,
        )
        .map((row) => row.propertyId),
    );
    return {
      ...allowance,
      protectedPropertyIds: [...protectedIds],
      expiredPropertyIds: [
        ...new Set(
          paid
            .filter((row) => !protectedIds.has(row.propertyId))
            .map((row) => row.propertyId),
        ),
      ],
    };
  }

  async expired(userId: string) {
    return this.prisma.subscription.findFirst({
      where: { userId, currentPeriodEnd: { lte: new Date() } },
    });
  }

  async quote(
    userId: string,
    tier: PaidTier,
    billingPeriod: BillingPeriod = 'monthly',
  ) {
    const active = await this.current(userId);
    const now = new Date();
    if (active && (active.billingPeriod ?? 'monthly') !== billingPeriod)
      throw new ConflictException(
        'Keep your current billing cycle when upgrading. You can switch cycles after it expires.',
      );
    if (active && PLANS[tier].amount <= PLANS[active.tier as PaidTier].amount)
      throw new ConflictException(
        'You can only upgrade an active subscription. Choose this plan after your current period ends.',
      );
    const differenceCents = Math.round(
      (planPrice(tier, billingPeriod) -
        (active
          ? Number(
              active.periodAmount ??
                planPrice(active.tier as PaidTier, billingPeriod),
            )
          : 0)) *
        100,
    );
    const amountCents = active
      ? Math.max(
          1,
          Math.round(
            (differenceCents *
              (active.currentPeriodEnd.getTime() - now.getTime())) /
              (active.currentPeriodEnd.getTime() -
                active.currentPeriodStart.getTime()),
          ),
        )
      : differenceCents;
    const details = {
      userId,
      tier,
      billingPeriod,
      planAmount: planPrice(tier, billingPeriod),
      listingLimit: PLANS[tier].listingLimit,
      amountCents,
      sourceTransactionId: active?.transactionId ?? null,
      periodStart: (active?.currentPeriodStart ?? now).toISOString(),
      periodEnd: (
        active?.currentPeriodEnd ??
        monthAfter(now, billingPeriod === 'annual' ? 12 : 1)
      ).toISOString(),
    };
    const quote = jwt.sign(details, this.quoteKey(), {
      algorithm: 'HS256',
      audience: 'subscription-quote',
      expiresIn: 300,
    });
    return {
      quote,
      amount: amountCents / 100,
      currency: 'USD',
      periodEnd: details.periodEnd,
      isUpgrade: active != null,
      billingPeriod,
    };
  }

  async purchase(
    userId: string,
    tier: PaidTier,
    requestId: string,
    method: PaymentMethod = 'aba_pay',
    quote?: string,
  ) {
    this.requirePayments();
    // Read the original intent first: a retry must not need an unexpired quote.
    const previous = await this.prisma.paymentTransaction.findUnique({
      where: { userId_requestId: { userId, requestId } },
    });
    if (previous) {
      this.requireMatchingPurchase(previous, tier);
      return this.gateway.checkout(previous);
    }
    const token = quote ?? (await this.quote(userId, tier)).quote;
    let details: SubscriptionQuote;
    try {
      details = jwt.verify(token, this.quoteKey(), {
        algorithms: ['HS256'],
        audience: 'subscription-quote',
      }) as SubscriptionQuote;
    } catch {
      throw new ConflictException(
        'Your price quote expired. Please review the price again.',
      );
    }
    if (
      details.userId !== userId ||
      details.tier !== tier ||
      !Number.isFinite(details.planAmount) ||
      !Number.isInteger(details.listingLimit)
    )
      throw new ConflictException(
        'This price quote belongs to a different checkout.',
      );
    const transaction = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 1))`;
      const repeated = await tx.paymentTransaction.findUnique({
        where: { userId_requestId: { userId, requestId } },
      });
      if (repeated) {
        this.requireMatchingPurchase(repeated, tier);
        return repeated;
      }
      const now = new Date();
      const subscription = await tx.subscription.findUnique({
        where: { userId },
      });
      const active =
        subscription && subscription.currentPeriodEnd > now
          ? subscription
          : null;
      if ((active?.transactionId ?? null) !== details.sourceTransactionId)
        throw new ConflictException(
          'Your subscription changed. Please review the price again.',
        );
      const pending = await tx.paymentTransaction.findFirst({
        where: { userId, purpose: 'SUBSCRIPTION', status: 'Pending' },
      });
      if (pending)
        throw new ConflictException(
          'A subscription payment is awaiting confirmation. Please finish that payment first.',
        );
      return tx.paymentTransaction.create({
        data: {
          userId,
          requestId,
          purpose: 'SUBSCRIPTION',
          subscriptionTier: tier,
          billingPeriod: details.billingPeriod ?? 'monthly',
          subscriptionPlanAmount: details.planAmount,
          subscriptionListingLimit: details.listingLimit,
          provider: this.provider.name,
          paymentMethod: method,
          amount: details.amountCents / 100,
          currency: 'USD',
          status: 'Pending',
          subscriptionPeriodStart: new Date(details.periodStart),
          subscriptionPeriodEnd: new Date(details.periodEnd),
        },
      });
    });
    return this.gateway.checkout(transaction);
  }

  private requireMatchingPurchase(
    previous: { purpose: string; subscriptionTier: string | null },
    tier: PaidTier,
  ) {
    if (
      previous.purpose !== 'SUBSCRIPTION' ||
      previous.subscriptionTier !== tier
    )
      throw new ConflictException('This checkout reference was already used.');
  }

  private requirePayments() {
    if (this.provider.name === 'MOCK') requireMockPayments();
    else if (process.env.PAYMENT_MODE !== 'live') requireMockPayments();
  }

  private quoteKey() {
    const key = process.env.INTERNAL_SERVICE_SECRET;
    if (!key || key.length < 32)
      throw new Error(
        'INTERNAL_SERVICE_SECRET (32+ characters) is required for price quotes',
      );
    return key;
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

interface SubscriptionQuote {
  userId: string;
  tier: PaidTier;
  billingPeriod: BillingPeriod;
  planAmount: number;
  listingLimit: number;
  amountCents: number;
  sourceTransactionId: string | null;
  periodStart: string;
  periodEnd: string;
}
