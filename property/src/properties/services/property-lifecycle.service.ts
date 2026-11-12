import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { Prisma } from '@tilomnov/prisma-client';
import { boundaryCentroid } from '../boundary-centroid';
import { BoundaryDto } from '../dto/boundary.dto';
import { PropertyNearbyService } from '../nearby/property-nearby.service';
import { assertValidDiscount } from '../property-discount';
import { priceDrop, priceDropColumns, pricedOf } from '../price-drop';
import { CreatePropertyDto } from '../dto/create-property.dto';
import { PinDto } from '../dto/pin.dto';
import { UpdatePropertyDto } from '../dto/update-property.dto';
import { PROPERTY_WITH_RELATIONS } from '../property-includes';
import { toCreateData, toUpdateData } from '../property-write-data';
import { PropertyStatusService } from '../property-status.service';
import { publishedAtGoingLive } from '../published-at';
import {
  NO_ENGAGEMENT,
  PropertyEngagementCounts,
  withEngagement,
} from './property-engagement-counts.service';
import { PropertyQueryService } from './property-query.service';
import { ListingChanges } from './listing-changes.service';
import { CachedListing, Position } from './public-property-cache.service';
import { PublishingAllowanceService } from './publishing-allowance.service';
import {
  assertTakeoverComplete,
  TakeoverListing,
  takeoverPrice,
} from '../takeover';
import { TAKEOVER_LISTING_TYPE } from '../property-options';
import { requireListingContact } from '../listing-contact';

/** The keyword codes of a property read with PROPERTY_WITH_RELATIONS. */
const keywordCodes = (property: { keywords?: { keyword: string }[] }) =>
  (property.keywords ?? []).map((k) => k.keyword);

/** The only status the public can see. */
const PUBLIC_STATUS = 'Active';

/** What decides whether a listing shows on the public map. */
type OnMapState = { status: string; lat: number | null };

const isOnMap = (listing: OnMapState) =>
  listing.status === PUBLIC_STATUS && listing.lat !== null;

/** Creating, editing and moving a property through its statuses. */
@Injectable()
export class PropertyLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: PropertyQueryService,
    private readonly status: PropertyStatusService,
    private readonly listingChanges: ListingChanges,
    private readonly nearby: PropertyNearbyService,
    private readonly counts: PropertyEngagementCounts,
    private readonly allowance: PublishingAllowanceService,
  ) {}

  async create(userId: string, dto: CreatePropertyDto) {
    if (dto.status === PUBLIC_STATUS)
      dto.contactPhone = await requireListingContact(
        this.prisma,
        userId,
        dto.contactPhone,
      );
    if (dto.status === PUBLIC_STATUS) assertTakeoverComplete(dto);
    assertValidDiscount(dto);
    const create = async (db: Prisma.TransactionClient) => {
      const created = await db.property.create({
        data: toCreateData(userId, dto),
        include: PROPERTY_WITH_RELATIONS,
      });
      if (this.listingChanges.queued)
        await this.announceIfNowOnMap(null, created, db);
      return created;
    };
    const property =
      dto.status === PUBLIC_STATUS
        ? await this.allowance.publish(userId, create)
        : await create(this.prisma);
    await this.refreshPublicView(property, [property.status]);
    if (!this.listingChanges.queued)
      void this.announceIfNowOnMap(null, property);
    // Nobody can have saved, opened or messaged about it yet.
    return { ...property, _count: NO_ENGAGEMENT };
  }

  async update(userId: string, id: string, dto: UpdatePropertyDto) {
    const before = await this.query.findOwned(userId, id);
    const after = { ...before, ...dto };
    if (before.status === PUBLIC_STATUS || before.status === 'Pending') {
      dto.contactPhone = await requireListingContact(
        this.prisma,
        userId,
        dto.contactPhone ?? before.contactPhone,
      );
      assertTakeoverComplete(after);
    }
    if (after.listingType === TAKEOVER_LISTING_TYPE) {
      dto = {
        ...dto,
        price: takeoverPrice(after.takeover) ?? Number(before.price),
      };
    }
    const pricedBefore = pricedOf(before);
    const pricedAfter = {
      price: dto.price ?? pricedBefore.price,
      discountType:
        dto.discountType !== undefined
          ? dto.discountType
          : pricedBefore.discountType,
      discountValue:
        dto.discountValue !== undefined
          ? dto.discountValue
          : pricedBefore.discountValue,
    };
    // The discount must still fit the price after the edit, whichever changed.
    assertValidDiscount(pricedAfter);
    const drop =
      before.status === PUBLIC_STATUS
        ? priceDrop(pricedBefore, pricedAfter)
        : null;
    const write = async (tx: Prisma.TransactionClient) => {
      const updated = await tx.property.update({
        where: { id },
        data: {
          ...toUpdateData(
            dto,
            before.propertyType,
            before.listingType,
            before.takeover != null,
          ),
          ...priceDropColumns(before, pricedAfter, drop),
        },
        include: PROPERTY_WITH_RELATIONS,
      });
      if (drop && this.listingChanges.queued)
        await this.listingChanges.priceDropped(id, drop, tx);
      return updated;
    };
    // An edit does not change the counts: read alongside it.
    const [property, counts] = await Promise.all([
      this.listingChanges.queued
        ? this.prisma.$transaction(write)
        : write(this.prisma),
      this.counts.of([id]),
    ]);
    await this.refreshPublicView(property, [before.status]);
    if (drop && !this.listingChanges.queued)
      void this.listingChanges.priceDropped(id, drop);
    if (dto.keywords) {
      this.nearby.keywordsChanged(id, keywordCodes(before), dto.keywords);
    }
    return withEngagement(property, counts);
  }

  async updatePin(userId: string, id: string, pin: PinDto) {
    const before = await this.query.findOwned(userId, id);
    const write = async (tx: Prisma.TransactionClient) => {
      const updated = await tx.property.update({
        where: { id },
        data: { lat: pin.lat, lng: pin.lng },
      });
      if (this.listingChanges.queued)
        await this.announceIfNowOnMap(before, updated, tx);
      return updated;
    };
    const property = this.listingChanges.queued
      ? await this.prisma.$transaction(write)
      : await write(this.prisma);
    await this.refreshPublicView(property, [before.status], before);
    if (!this.listingChanges.queued)
      void this.announceIfNowOnMap(before, property);
    this.nearby.locationChanged(id);
    return property;
  }

  /** Saves the drawn boundary and re-centres the pin on it. */
  async updateBoundary(userId: string, id: string, dto: BoundaryDto) {
    const before = await this.query.findOwned(userId, id);
    const boundaryPoints = dto.boundaryPoints.map(({ lat, lng }) => ({
      lat,
      lng,
    }));
    const center = boundaryCentroid(boundaryPoints);

    const write = async (tx: Prisma.TransactionClient) => {
      const updated = await tx.property.update({
        where: { id },
        data: {
          boundaryPoints,
          ...(center && { lat: center.lat, lng: center.lng }),
        },
      });
      if (this.listingChanges.queued)
        await this.announceIfNowOnMap(before, updated, tx);
      return updated;
    };
    const property = this.listingChanges.queued
      ? await this.prisma.$transaction(write)
      : await write(this.prisma);
    await this.refreshPublicView(property, [before.status], before);
    if (!this.listingChanges.queued)
      void this.announceIfNowOnMap(before, property);
    if (center) this.nearby.locationChanged(id);
    return property;
  }

  async remove(userId: string, id: string) {
    const property = await this.query.findOwned(userId, id);
    return this.setStatus(property, 'Deleted');
  }

  async unpublish(userId: string, id: string) {
    const property = await this.query.findOwned(userId, id);
    return this.setStatus(property, 'Draft');
  }

  async publish(userId: string, id: string) {
    const property = await this.query.findOwned(userId, id);
    this.status.canPublish(property.status);
    return this.setStatus(property, 'Active');
  }

  async markSold(userId: string, id: string) {
    const property = await this.query.findOwned(userId, id);
    this.status.canMarkSold(property.status);
    return this.setStatus(property, 'Sold');
  }

  async relist(userId: string, id: string) {
    const property = await this.query.findOwned(userId, id);
    this.status.canRelist(property.status);
    return this.setStatus(property, 'Active');
  }

  private async setStatus(
    before: OnMapState &
      TakeoverListing & {
        id: string;
        userId: string;
        publishedAt: Date | null;
        contactPhone?: string | null;
      },
    to: string,
  ) {
    if (to === PUBLIC_STATUS) assertTakeoverComplete(before);
    const contactPhone =
      to === PUBLIC_STATUS
        ? await requireListingContact(
            this.prisma,
            before.userId,
            before.contactPhone,
          )
        : undefined;
    if (before.status === 'Pending') {
      throw new BadRequestException(
        'This property has a payment in progress. Please wait for confirmation.',
      );
    }
    const update = async (db: Prisma.TransactionClient) => {
      const updated = await db.property.update({
        where: { id: before.id, status: before.status },
        // Going live dates it in the feed only the first time, or when it is
        // back on the market (see publishedAtGoingLive).
        data: {
          status: to,
          ...(contactPhone && { contactPhone }),
          ...(to === PUBLIC_STATUS && {
            publishedAt: publishedAtGoingLive(
              before.status,
              before.publishedAt,
            ),
          }),
        },
      });
      if (this.listingChanges.queued) {
        await this.announceIfNowOnMap(before, updated, db);
        if (to === 'Sold' && before.status === PUBLIC_STATUS)
          await this.listingChanges.sold(updated.id, db);
      }
      return updated;
    };
    const property =
      to === PUBLIC_STATUS
        ? await this.allowance.publish(before.userId, update, before.id)
        : this.listingChanges.queued
          ? await this.prisma.$transaction(update)
          : await update(this.prisma);
    await this.refreshPublicView(property, [before.status, to]);
    if (!this.listingChanges.queued)
      void this.announceIfNowOnMap(before, property);
    if (
      !this.listingChanges.queued &&
      to === 'Sold' &&
      before.status === PUBLIC_STATUS
    ) {
      void this.listingChanges.sold(property.id);
    }
    return property;
  }

  /**
   * The public can now find the listing on the map, and could not before: it
   * is live and has a location. The app creates a listing live and gives it
   * its boundary right after, so either step can be the one. Alerts and
   * pushes follow (`ListingChanges.wentLive`), behind the answer.
   */
  private async announceIfNowOnMap(
    before: OnMapState | null,
    after: OnMapState & { id: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (isOnMap(after) && !(before && isOnMap(before))) {
      await this.listingChanges.wentLive(
        after.id,
        ...(tx ? ([tx] as const) : []),
      );
    }
  }

  /**
   * Drops the cached public copies when the public could see this listing
   * before or can see it now. Work on a draft changes nothing anyone else sees.
   */
  private async refreshPublicView(
    listing: CachedListing,
    statuses: string[],
    movedFrom?: Position,
  ) {
    if (statuses.includes(PUBLIC_STATUS)) {
      await this.listingChanges.changed(listing, movedFrom);
    }
  }
}
