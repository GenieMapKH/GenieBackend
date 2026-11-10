import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PropertyStatusService } from '../property-status.service';
import { datesAnew } from '../published-at';
import { PropertyQueryService } from './property-query.service';
import { ListingChanges } from './listing-changes.service';
import { CACHED_LISTING_SELECT } from './public-property-cache.service';
import { assertTakeoverComplete } from '../takeover';
import { requireListingContact } from '../listing-contact';
import { PublishingAllowanceService } from './publishing-allowance.service';

/** How a payment ended, as far as the listing is concerned. */
export type PublishOutcome = 'Active' | 'Draft';

/**
 * The listing's side of paying to publish. The payment service owns the money
 * and decides when a payment is settled; this service owns the listing's
 * status, so every status change still goes through its rules.
 */
@Injectable()
export class PropertyPublicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: PropertyQueryService,
    private readonly status: PropertyStatusService,
    private readonly listingChanges: ListingChanges,
    private readonly allowance: PublishingAllowanceService,
  ) {}

  /**
   * A payment to publish is starting: only the owner may pay, and only from a
   * publishable status. The listing waits as Pending. Answers the status it
   * had, so the payment service can put it back if it cannot go on.
   */
  async beginPublish(
    userId: string,
    propertyId: string,
  ): Promise<{ previousStatus: string }> {
    const property = await this.query.findOwned(userId, propertyId);
    this.status.canPublish(property.status);
    assertTakeoverComplete(property);
    const contactPhone = await requireListingContact(
      this.prisma,
      userId,
      property.contactPhone,
    );

    const changed = await this.allowance.payToPublish(
      userId,
      propertyId,
      (tx) =>
        tx.property.updateMany({
          where: { id: propertyId, userId, status: property.status },
          // Paying to put a sold or expired listing back on the market dates it
          // anew once paid (see settlePublish); a draft keeps its first date.
          data: {
            status: 'Pending',
            contactPhone,
            ...(datesAnew(property.status) && { publishedAt: null }),
          },
        }),
    );
    if (changed.count === 0)
      throw new ConflictException(
        'A payment is already in progress for this property.',
      );
    return { previousStatus: property.status };
  }

  /**
   * The payment ended: a paid listing goes live, an unpaid one goes back to
   * Draft. Only a Pending listing changes, so repeating the call is harmless.
   */
  async settlePublish(
    propertyId: string,
    outcome: PublishOutcome,
  ): Promise<void> {
    const { count } =
      outcome === 'Active'
        ? await this.goLive(propertyId)
        : await this.prisma.property.updateMany({
            where: { id: propertyId, status: 'Pending' },
            data: { status: outcome },
          });
    // The listing just went live: let the map show it without waiting for the cache to expire.
    if (outcome === 'Active' && count > 0) {
      const listing = await this.prisma.property.findUnique({
        where: { id: propertyId },
        select: CACHED_LISTING_SELECT,
      });
      if (listing) await this.listingChanges.changed(listing);
      void this.listingChanges.wentLive(propertyId);
    }
  }

  /**
   * A paid Pending listing goes live. Dated now when it has no date (never
   * live, or back on the market: see beginPublish); a draft that was live
   * before keeps its first date.
   */
  private async goLive(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { takeover: { include: { additionalPayments: true } } },
    });
    if (property?.status === 'Pending') {
      assertTakeoverComplete(property);
      await requireListingContact(
        this.prisma,
        property.userId,
        property.contactPhone,
      );
    }
    const dated = await this.prisma.property.updateMany({
      where: { id: propertyId, status: 'Pending', publishedAt: null },
      data: { status: 'Active', publishedAt: new Date() },
    });
    if (dated.count > 0) return dated;
    return this.prisma.property.updateMany({
      where: { id: propertyId, status: 'Pending' },
      data: { status: 'Active' },
    });
  }

  /** The payment could not be started: the listing returns to the status it had. */
  async revertPublish(propertyId: string, status: string): Promise<void> {
    await this.prisma.property.updateMany({
      where: { id: propertyId, status: 'Pending' },
      data: { status },
    });
  }
}
