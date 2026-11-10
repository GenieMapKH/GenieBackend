import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService, ServiceClient } from '@tilomnov/shared';
import { isUUID } from 'class-validator';
import { ListingChanges } from './listing-changes.service';
import { CACHED_LISTING_SELECT } from './public-property-cache.service';

/** Retains separately paid listings and the oldest listings within the current plan. */
@Injectable()
export class ExpiredPublishingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiredPublishingService.name);
  private readonly payment = new ServiceClient(
    'payment',
    process.env.PAYMENT_SERVICE_URL || 'http://localhost:4005',
    'property',
  );
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ListingChanges,
  ) {}

  onModuleInit(): void {
    void this.run();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async run(): Promise<void> {
    try {
      let after: string | undefined;
      do {
        const owners = await this.prisma.property.groupBy({
          by: ['userId'],
          where: { status: 'Active', ...(after && { userId: { gt: after } }) },
          orderBy: { userId: 'asc' },
          take: 100,
        });
        if (!owners.length) break;
        for (const { userId } of owners) {
          if (this.stopped) return;
          await this.reconcile(userId).catch((error: Error) =>
            this.logger.error(
              `Publishing expiry for ${userId}: ${error.message}`,
            ),
          );
        }
        after = owners[owners.length - 1].userId;
      } while (!this.stopped);
    } catch (error) {
      this.logger.error(
        `Publishing expiry scan failed: ${(error as Error).message}`,
      );
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.run(), 30_000);
        this.timer.unref();
      }
    }
  }

  async reconcile(userId: string): Promise<void> {
    const expired = await this.prisma.$transaction(
      async (tx) => {
        // Payment changes lock 1; publishing locks 2. This order prevents stale-plan cleanup.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 1))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 2))`;
        const entitlement = await this.payment.call<{
          listingLimit: number;
          expiresAt: string | null;
          protectedPropertyIds: string[];
          expiredPropertyIds: string[];
        }>('GET', `/internal/subscriptions/${userId}/publishing`, {
          timeoutMs: 8000,
        });
        if (
          !Number.isInteger(entitlement.listingLimit) ||
          entitlement.listingLimit < 1 ||
          (entitlement.expiresAt !== null &&
            !Number.isFinite(Date.parse(entitlement.expiresAt))) ||
          !Array.isArray(entitlement.protectedPropertyIds) ||
          !entitlement.protectedPropertyIds.every(
            (id) => typeof id === 'string' && isUUID(id),
          ) ||
          !Array.isArray(entitlement.expiredPropertyIds) ||
          !entitlement.expiredPropertyIds.every(
            (id) => typeof id === 'string' && isUUID(id),
          )
        )
          throw new Error('Invalid publishing entitlements');
        const limit =
          entitlement.expiresAt !== null &&
          Date.parse(entitlement.expiresAt) <= Date.now()
            ? 1
            : entitlement.listingLimit;
        const listings = await tx.property.findMany({
          where: { userId, status: 'Active' },
          select: CACHED_LISTING_SELECT,
          orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
        });
        const paid = new Set(entitlement.protectedPropertyIds);
        const candidates = listings.filter((listing) => !paid.has(listing.id));
        const excess = candidates.slice(limit);
        if (excess.length)
          await tx.property.updateMany({
            where: {
              userId,
              status: 'Active',
              id: { in: excess.map((listing) => listing.id) },
            },
            data: { status: 'Draft' },
          });
        return excess;
      },
      { timeout: 15_000 },
    );
    for (const listing of expired) await this.changes.changed(listing);
  }
}
