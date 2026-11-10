import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { ListingNotificationsClient } from '../notifications/listing-notifications.client';
import { PUBLISHED } from '../properties/property-includes';
import {
  ListingChanges,
  ListingEventListener,
} from '../properties/services/listing-changes.service';
import { AccountFollowers } from './account-followers';
import { ownerName } from './owner-name';

/**
 * When a listing first goes on the map, tells everyone following its owner.
 * Once per listing (`followers_notified_at`, claimed atomically): publishing
 * it again, moving it or relisting it tells nobody twice, as the feed does
 * not move it up either.
 */
@Injectable()
export class FollowerAlerts implements ListingEventListener, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ListingChanges,
    private readonly followers: AccountFollowers,
    private readonly notifications: ListingNotificationsClient,
  ) {}

  onModuleInit(): void {
    this.changes.listenToEvents(this);
  }

  async listingWentLive(propertyId: string): Promise<void> {
    const { count } = await this.prisma.property.updateMany({
      where: { id: propertyId, followersNotifiedAt: null, ...PUBLISHED },
      data: { followersNotifiedAt: new Date() },
    });
    if (count === 0) return;

    const listing = await this.prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: {
        id: true,
        title: true,
        userId: true,
        user: { select: { name: true, username: true } },
      },
    });
    const followerIds = await this.followers.idsFollowing(listing.userId);
    if (followerIds.length === 0) return;
    await this.notifications.followedListing(
      listing,
      ownerName(listing.user),
      followerIds,
    );
  }
}
