import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { currentServiceMessage, MessageBus } from '@tilomnov/shared';
import { Prisma } from '@tilomnov/prisma-client';
import { IsNumber, IsUUID, Min } from 'class-validator';
import {
  CachedListing,
  Position,
  PublicPropertyCache,
} from './public-property-cache.service';

class ListingEvent {
  @IsUUID() propertyId: string;
}
class ListingPriceDroppedEvent extends ListingEvent {
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) from: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) to: number;
}

/** Told about every change to what the public can see of a listing. */
export interface ListingChangeListener {
  listingChanged(listing: CachedListing): Promise<void>;
}

/**
 * Told about what happened to a live listing, for alerts and pushes. Each
 * method is optional: a listener implements what it cares about.
 */
export interface ListingEventListener {
  /** It went on the map: live, with a location (new, published, relisted, paid for, located). */
  listingWentLive?(propertyId: string): Promise<void>;
  /** The price a buyer pays fell, from [from] to [to] (USD, after any discount). */
  listingPriceDropped?(
    propertyId: string,
    drop: { from: number; to: number },
  ): Promise<void>;
  /** The owner marked it sold. */
  listingSold?(propertyId: string): Promise<void>;
}

/**
 * The one path a change to what the public sees of a listing takes (new,
 * edited, moved, published, hidden, sold, deleted, photos, its owner hidden
 * or renamed): the cached public copies are outdated, then every listener
 * (the search index) is told. Modules that need to know listen here, so this
 * module depends on none of them.
 */
@Injectable()
export class ListingChanges implements OnModuleInit {
  private readonly logger = new Logger(ListingChanges.name);
  private readonly listeners: ListingChangeListener[] = [];
  private readonly eventListeners: ListingEventListener[] = [];

  constructor(
    private readonly publicCache: PublicPropertyCache,
    @Optional() private readonly messages?: MessageBus,
  ) {}

  get queued(): boolean {
    return this.messages?.enabled === true;
  }

  onModuleInit(): void {
    this.messages?.handleValidated(
      'property.listing-went-live.v1',
      ListingEvent,
      (event) =>
        this.tell('going live', event.propertyId, (listener) =>
          listener.listingWentLive?.(event.propertyId),
        ),
    );
    this.messages?.handleValidated(
      'property.listing-price-dropped.v1',
      ListingPriceDroppedEvent,
      (event) =>
        this.tell('its price drop', event.propertyId, (listener) =>
          listener.listingPriceDropped?.(event.propertyId, {
            from: event.from,
            to: event.to,
          }),
        ),
    );
    this.messages?.handleValidated(
      'property.listing-sold.v1',
      ListingEvent,
      (event) =>
        this.tell('being sold', event.propertyId, (listener) =>
          listener.listingSold?.(event.propertyId),
        ),
    );
  }

  listen(listener: ListingChangeListener): void {
    this.listeners.push(listener);
  }

  listenToEvents(listener: ListingEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Listing `propertyId` just went on the map. Each event's listeners run
   * behind the answer: the write never waits for them, and one that fails is
   * logged.
   */
  wentLive(propertyId: string, tx?: Prisma.TransactionClient): Promise<void> {
    if (this.queued)
      return this.messages!.enqueue(
        'property.listing-went-live.v1',
        { propertyId },
        { tx },
      );
    return this.tell('going live', propertyId, (listener) =>
      listener.listingWentLive?.(propertyId),
    );
  }

  priceDropped(
    propertyId: string,
    drop: { from: number; to: number },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (this.queued)
      return this.messages!.enqueue(
        'property.listing-price-dropped.v1',
        { propertyId, ...drop },
        { tx },
      );
    return this.tell('its price drop', propertyId, (listener) =>
      listener.listingPriceDropped?.(propertyId, drop),
    );
  }

  sold(propertyId: string, tx?: Prisma.TransactionClient): Promise<void> {
    if (this.queued)
      return this.messages!.enqueue(
        'property.listing-sold.v1',
        { propertyId },
        { tx },
      );
    return this.tell('being sold', propertyId, (listener) =>
      listener.listingSold?.(propertyId),
    );
  }

  private async tell(
    what: string,
    propertyId: string,
    call: (listener: ListingEventListener) => Promise<void> | undefined,
  ): Promise<void> {
    const results = await Promise.allSettled(
      this.eventListeners.map((listener) =>
        (call(listener) ?? Promise.resolve()).catch((error: Error) => {
          this.logger.error(
            `A listener missed listing ${propertyId} ${what}: ${error.message}`,
          );
          if (this.queued) throw error;
        }),
      ),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  /**
   * A listener that fails is logged, never thrown: the change itself is
   * saved, and whatever the listener keeps is repaired on its own schedule.
   */
  async changed(listing: CachedListing, movedFrom?: Position): Promise<void> {
    await this.publicCache.changed(listing, movedFrom);
    const queuedVisibility =
      currentServiceMessage()?.type === 'property.account-visibility.v1';
    const results = await Promise.allSettled(
      this.listeners.map((listener) =>
        listener.listingChanged(listing).catch((error: Error) => {
          this.logger.error(
            `A listener missed the change to listing ${listing.id}: ${error.message}`,
          );
          if (queuedVisibility) throw error;
        }),
      ),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}
