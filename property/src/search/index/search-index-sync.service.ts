import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PUBLISHED } from '../../properties/property-includes';
import {
  ListingChangeListener,
  ListingChanges,
} from '../../properties/services/listing-changes.service';
import { CachedListing } from '../../properties/services/public-property-cache.service';
import { PUBLISHER } from '../people-search.service';
import {
  isFindablePublisher,
  isSearchable,
  LISTING_DOCUMENT_SELECT,
  listingDocument,
  PUBLISHER_DOCUMENT_SELECT,
  publisherDocument,
} from './search-documents';
import {
  ListingDocument,
  PublisherDocument,
  SearchEngine,
} from './search-engine';

/** Rows read per batch of a full reindex. */
const BATCH_SIZE = 1_000;

/**
 * Keeps the search engine in step with the database: every listing change
 * updates or removes the listing and its owner, and `reindexAll` rebuilds
 * everything (repairing any change the engine missed while it was down).
 */
@Injectable()
export class SearchIndexSync implements ListingChangeListener, OnModuleInit {
  /** Listings changed while a full reindex runs; null when none runs. */
  private changedDuringReindex: Map<string, CachedListing> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: SearchEngine,
    private readonly changes: ListingChanges,
  ) {}

  onModuleInit(): void {
    if (this.engine.isConfigured) this.changes.listen(this);
  }

  /** Indexes the listing as the database has it now, or takes it out; then its owner. */
  async listingChanged(listing: CachedListing): Promise<void> {
    this.changedDuringReindex?.set(listing.id, listing);
    const row = await this.prisma.property.findUnique({
      where: { id: listing.id },
      select: LISTING_DOCUMENT_SELECT,
    });
    if (row && isSearchable(row)) {
      await this.engine.saveListing(listingDocument(row));
    } else {
      await this.engine.removeListing(listing.id);
    }
    await this.publisherChanged(listing.userId);
  }

  /**
   * Replaces the whole index with what the database holds. The snapshot may
   * predate a change made while it was taken, so those changes are applied
   * again once it is in place.
   */
  async reindexAll(): Promise<void> {
    this.changedDuringReindex = new Map();
    try {
      await this.engine.replaceAll(
        this.listingBatches(),
        this.publisherBatches(),
      );
    } finally {
      const missed = [...this.changedDuringReindex.values()];
      this.changedDuringReindex = null;
      for (const listing of missed) await this.listingChanged(listing);
    }
  }

  private async publisherChanged(userId: string): Promise<void> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLISHER_DOCUMENT_SELECT,
    });
    if (row && isFindablePublisher(row)) {
      await this.engine.savePublisher(publisherDocument(row));
    } else {
      await this.engine.removePublisher(userId);
    }
  }

  private async *listingBatches(): AsyncGenerator<ListingDocument[]> {
    let after: string | undefined;
    for (;;) {
      const rows = await this.prisma.property.findMany({
        where: PUBLISHED,
        select: LISTING_DOCUMENT_SELECT,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      });
      if (rows.length === 0) return;
      yield rows.map(listingDocument);
      after = rows[rows.length - 1].id;
    }
  }

  private async *publisherBatches(): AsyncGenerator<PublisherDocument[]> {
    let after: string | undefined;
    for (;;) {
      const rows = await this.prisma.user.findMany({
        where: PUBLISHER,
        select: PUBLISHER_DOCUMENT_SELECT,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      });
      if (rows.length === 0) return;
      yield rows.map(publisherDocument);
      after = rows[rows.length - 1].id;
    }
  }
}
