import { Injectable, Logger } from '@nestjs/common';
import {
  CachedListing,
  Position,
  PublicPropertyCache,
} from './public-property-cache.service';

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
export class ListingChanges {
  private readonly logger = new Logger(ListingChanges.name);
  private readonly listeners: ListingChangeListener[] = [];
  private readonly eventListeners: ListingEventListener[] = [];

  constructor(private readonly publicCache: PublicPropertyCache) {}

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
  wentLive(propertyId: string): Promise<void> {
    return this.tell('going live', propertyId, (listener) =>
      listener.listingWentLive?.(propertyId),
    );
  }

  priceDropped(
    propertyId: string,
    drop: { from: number; to: number },
  ): Promise<void> {
    return this.tell('its price drop', propertyId, (listener) =>
      listener.listingPriceDropped?.(propertyId, drop),
    );
  }

  sold(propertyId: string): Promise<void> {
    return this.tell('being sold', propertyId, (listener) =>
      listener.listingSold?.(propertyId),
    );
  }

  private async tell(
    what: string,
    propertyId: string,
    call: (listener: ListingEventListener) => Promise<void> | undefined,
  ): Promise<void> {
    await Promise.all(
      this.eventListeners.map((listener) =>
        (call(listener) ?? Promise.resolve()).catch((error: Error) => {
          this.logger.error(
            `A listener missed listing ${propertyId} ${what}: ${error.message}`,
          );
        }),
      ),
    );
  }

  /**
   * A listener that fails is logged, never thrown: the change itself is
   * saved, and whatever the listener keeps is repaired on its own schedule.
   */
  async changed(listing: CachedListing, movedFrom?: Position): Promise<void> {
    await this.publicCache.changed(listing, movedFrom);
    await Promise.all(
      this.listeners.map((listener) =>
        listener.listingChanged(listing).catch((error: Error) => {
          this.logger.error(
            `A listener missed the change to listing ${listing.id}: ${error.message}`,
          );
        }),
      ),
    );
  }
}
