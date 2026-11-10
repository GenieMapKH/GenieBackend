import {
  HttpException,
  HttpStatus,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService, ServiceClient } from '@tilomnov/shared';
import { isUUID } from 'class-validator';

type PublishingEntitlements = {
  listingLimit: number;
  expiresAt: string | null;
  protectedPropertyIds: string[];
  expiredPropertyIds: string[];
};

/** Checks payment-owned entitlements and reserves a place in the same DB transaction as publishing. */
@Injectable()
export class PublishingAllowanceService {
  private readonly payment = new ServiceClient(
    'payment',
    process.env.PAYMENT_SERVICE_URL || 'http://localhost:4005',
    'property',
  );

  constructor(private readonly prisma: PrismaService) {}

  async usage(userId: string) {
    const allowance = await this.entitlements(userId);
    return {
      used: await this.countUsed(this.prisma, userId, allowance),
      listingLimit: this.hasPaidPlan(allowance) ? allowance.listingLimit : 1,
    };
  }

  async publish<T>(
    userId: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
    propertyId?: string,
  ): Promise<T> {
    const allowance = await this.entitlements(userId);
    return this.prisma.$transaction(async (tx) => {
      // Two concurrent publishes must not both take the account's last free place.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 2))`;
      if (propertyId && allowance.protectedPropertyIds.includes(propertyId))
        return write(tx);
      const paidPlan = this.hasPaidPlan(allowance);
      const limit = paidPlan ? allowance.listingLimit : 1;
      const used = await this.countUsed(tx, userId, allowance);
      if (used >= limit) {
        throw new HttpException(
          {
            code: 'PUBLISHING_PLAN_REQUIRED',
            message:
              'Please choose a publishing plan or a one-time payment to publish this property.',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      return write(tx);
    });
  }

  /** A covered listing must use its included capacity instead of paying again. */
  async payToPublish<T>(
    userId: string,
    propertyId: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const allowance = await this.entitlements(userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 2))`;
      const limit = this.hasPaidPlan(allowance) ? allowance.listingLimit : 1;
      if (
        allowance.protectedPropertyIds.includes(propertyId) ||
        (await this.countUsed(tx, userId, allowance)) < limit
      )
        throw new ConflictException(
          'Your plan covers this listing. Publish it without a payment.',
        );
      return write(tx);
    });
  }

  private countUsed(
    db: Pick<PrismaService, 'property'>,
    userId: string,
    allowance: PublishingEntitlements,
  ) {
    return db.property.count({
      where: {
        userId,
        status: 'Active',
        id: {
          notIn: allowance.protectedPropertyIds,
        },
      },
    });
  }

  private hasPaidPlan(allowance: PublishingEntitlements) {
    return (
      allowance.expiresAt !== null &&
      Date.parse(allowance.expiresAt) > Date.now()
    );
  }

  private async entitlements(userId: string): Promise<PublishingEntitlements> {
    try {
      const allowance = await this.payment.call<PublishingEntitlements>(
        'GET',
        `/internal/subscriptions/${userId}/publishing`,
        { timeoutMs: 8000 },
      );
      if (
        !Number.isInteger(allowance.listingLimit) ||
        allowance.listingLimit < 1 ||
        (allowance.expiresAt !== null &&
          !Number.isFinite(Date.parse(allowance.expiresAt))) ||
        !Array.isArray(allowance.protectedPropertyIds) ||
        !allowance.protectedPropertyIds.every(
          (id) => typeof id === 'string' && isUUID(id),
        ) ||
        !Array.isArray(allowance.expiredPropertyIds) ||
        !allowance.expiredPropertyIds.every(
          (id) => typeof id === 'string' && isUUID(id),
        )
      ) {
        throw new Error('Invalid publishing allowance');
      }
      return allowance;
    } catch {
      throw new ServiceUnavailableException(
        'We could not check your publishing plan. Please try again.',
      );
    }
  }
}
