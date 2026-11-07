import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService, ServiceClient } from '@tilomnov/shared';

/** Checks payment-owned entitlements and reserves a place in the same DB transaction as publishing. */
@Injectable()
export class PublishingAllowanceService {
  private readonly payment = new ServiceClient(
    'payment',
    process.env.PAYMENT_SERVICE_URL || 'http://localhost:4005',
    'property',
  );

  constructor(private readonly prisma: PrismaService) {}

  async publish<T>(
    userId: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let allowance: { listingLimit: number; expiresAt: string | null };
    try {
      allowance = await this.payment.call(
        'GET',
        `/internal/subscriptions/${userId}/allowance`,
        { timeoutMs: 8000 },
      );
      if (
        !Number.isInteger(allowance.listingLimit) ||
        allowance.listingLimit < 1 ||
        (allowance.expiresAt !== null &&
          !Number.isFinite(Date.parse(allowance.expiresAt)))
      ) {
        throw new Error('Invalid publishing allowance');
      }
    } catch {
      throw new ServiceUnavailableException(
        'We could not check your publishing plan. Please try again.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Two concurrent publishes must not both take the account's last free place.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 2))`;
      const limit =
        allowance.expiresAt !== null &&
        Date.parse(allowance.expiresAt) <= Date.now()
          ? 1
          : allowance.listingLimit;
      const used = await tx.property.count({
        where: { userId, status: { in: ['Active', 'Pending'] } },
      });
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
}
