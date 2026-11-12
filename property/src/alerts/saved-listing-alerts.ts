import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { ListingNotificationsClient } from '../notifications/listing-notifications.client';
import { Prisma } from '@tilomnov/prisma-client';
import {
  ListingChanges,
  ListingEventListener,
} from '../properties/services/listing-changes.service';

/** People who saved a listing hear of its price drops at most this often. */
const PRICE_DROP_PUSH_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * Tells the people who saved a listing when its price drops, or when it is
 * sold, so they act on it or stop chasing it. The owner is never told.
 */
@Injectable()
export class SavedListingAlerts implements ListingEventListener, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ListingChanges,
    private readonly notifications: ListingNotificationsClient,
  ) {}

  onModuleInit(): void {
    this.changes.listenToEvents(this);
  }

  /**
   * One push per listing a day, claimed atomically: a row of small cuts in
   * an afternoon is one notification. The drop is still marked on the
   * listing each time.
   */
  async listingPriceDropped(
    propertyId: string,
    drop: { from: number; to: number },
  ): Promise<void> {
    const now = new Date();
    const notify = async (tx: Prisma.TransactionClient) => {
      const { count } = await tx.property.updateMany({
        where: {
          id: propertyId,
          status: 'Active',
          OR: [
            { priceDropNotifiedAt: null },
            {
              priceDropNotifiedAt: {
                lt: new Date(now.getTime() - PRICE_DROP_PUSH_GAP_MS),
              },
            },
          ],
        },
        data: { priceDropNotifiedAt: now },
      });
      if (count === 0) return;
      await this.tellSavers(propertyId, { kind: 'price_drop', ...drop }, tx);
    };
    if (this.notifications.queued) await this.prisma.$transaction(notify);
    else await notify(this.prisma);
  }

  async listingSold(propertyId: string): Promise<void> {
    await this.tellSavers(propertyId, { kind: 'sold' });
  }

  private async tellSavers(
    propertyId: string,
    update: { kind: 'price_drop'; from: number; to: number } | { kind: 'sold' },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const listing = await tx.property.findUnique({
      where: { id: propertyId },
      select: { id: true, title: true, userId: true },
    });
    if (!listing) return;
    const savers = await tx.propertyFavorite.findMany({
      where: { propertyId, userId: { not: listing.userId } },
      select: { userId: true },
    });
    if (savers.length === 0) return;
    await this.notifications.savedListingUpdate(
      listing,
      update,
      savers.map((saver) => saver.userId),
      ...(this.notifications.queued ? ([tx] as const) : []),
    );
  }
}
