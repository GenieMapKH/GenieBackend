import { Injectable, Logger } from '@nestjs/common';
import {
  currentServiceMessage,
  MessageBus,
  MessageType,
  ServiceClient,
} from '@tilomnov/shared';
import { Prisma } from '@tilomnov/prisma-client';

/** A push is a courtesy: never wait long for one. */
const NOTIFY_TIMEOUT_MS = 5_000;

/** The most people the notification service takes in one call. */
export const RECIPIENTS_PER_CALL = 500;

/** The longest title and name the notification service takes. */
const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 100;

/**
 * Asks the notification service to tell people about a listing. Never
 * throws: a listing is live whether or not the pushes go out, so a failure
 * is logged.
 */
@Injectable()
export class ListingNotificationsClient {
  private readonly logger = new Logger(ListingNotificationsClient.name);
  private readonly client = new ServiceClient(
    'notification',
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4006',
    'property',
  );

  constructor(private readonly messages: MessageBus) {}
  get queued(): boolean {
    return this.messages.enabled;
  }

  /** Each recipient's saved search [searchName] matches the listing. */
  async savedSearchMatch(
    listing: { id: string; title: string },
    recipients: { userId: string; searchName: string }[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.inChunks(recipients, (chunk, index) =>
      this.post(
        'saved-search-match',
        {
          propertyId: listing.id,
          title: listing.title.slice(0, MAX_TITLE_LENGTH),
          recipients: chunk,
        },
        index,
        tx,
      ),
    );
  }

  /** [ownerName], whom each of [userIds] follows, posted the listing. */
  async followedListing(
    listing: { id: string; title: string },
    ownerName: string,
    userIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.inChunks(userIds, (chunk, index) =>
      this.post(
        'followed-listing',
        {
          propertyId: listing.id,
          title: listing.title.slice(0, MAX_TITLE_LENGTH),
          ownerName: ownerName.slice(0, MAX_NAME_LENGTH),
          recipients: chunk,
        },
        index,
        tx,
      ),
    );
  }

  /** A listing each of [userIds] saved dropped its price, or was sold. */
  async savedListingUpdate(
    listing: { id: string; title: string },
    update: { kind: 'price_drop'; from: number; to: number } | { kind: 'sold' },
    userIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.inChunks(userIds, (chunk, index) =>
      this.post(
        'saved-listing-update',
        {
          propertyId: listing.id,
          title: listing.title.slice(0, MAX_TITLE_LENGTH),
          ...update,
          recipients: chunk,
        },
        index,
        tx,
      ),
    );
  }

  private async inChunks<T>(
    items: T[],
    send: (chunk: T[], index: number) => Promise<void>,
  ): Promise<void> {
    for (let start = 0; start < items.length; start += RECIPIENTS_PER_CALL) {
      await send(items.slice(start, start + RECIPIENTS_PER_CALL), start);
    }
  }

  private async post(
    event: string,
    body: object,
    index: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (this.queued) {
      const origin = currentServiceMessage();
      await this.messages.enqueue(
        `notification.${event}.v1` as MessageType,
        body,
        {
          tx,
          ...(origin && { key: `${origin.id}:${event}:${index}` }),
        },
      );
      return;
    }
    try {
      await this.client.call('POST', `/internal/notifications/${event}`, {
        body,
        timeoutMs: NOTIFY_TIMEOUT_MS,
      });
    } catch (error) {
      this.logger.warn(`Push "${event}" not sent: ${(error as Error).message}`);
    }
  }
}
