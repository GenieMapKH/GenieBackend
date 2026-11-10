import { ListingDocument, PublisherDocument } from './search-engine';

/** What a listing document is made of, and what decides whether it is indexed at all. */
export const LISTING_DOCUMENT_SELECT = {
  id: true,
  userId: true,
  title: true,
  description: true,
  propertyType: true,
  listingType: true,
  createdAt: true,
  status: true,
  user: { select: { deactivatedAt: true } },
} as const;

/** What a publisher document is made of. No email or phone is ever selected. */
export const PUBLISHER_DOCUMENT_SELECT = {
  id: true,
  name: true,
  username: true,
  deactivatedAt: true,
  _count: { select: { properties: { where: { status: 'Active' } } } },
} as const;

export interface ListingRow {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  propertyType: string;
  listingType: string | null;
  createdAt: Date;
  status: string;
  user: { deactivatedAt: Date | null };
}

export interface PublisherRow {
  id: string;
  name: string | null;
  username: string | null;
  deactivatedAt: Date | null;
  _count: { properties: number };
}

/** Whether the public may find the listing: published, by an account that is not hidden. */
export function isSearchable(listing: ListingRow): boolean {
  return listing.status === 'Active' && listing.user.deactivatedAt === null;
}

/** Whether the public may find the person: not hidden, with something published. */
export function isFindablePublisher(publisher: PublisherRow): boolean {
  return publisher.deactivatedAt === null && publisher._count.properties > 0;
}

export function listingDocument(listing: ListingRow): ListingDocument {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description ?? '',
    propertyType: listing.propertyType,
    listingType: listing.listingType,
    createdAt: listing.createdAt.getTime(),
  };
}

export function publisherDocument(publisher: PublisherRow): PublisherDocument {
  return {
    id: publisher.id,
    name: publisher.name,
    username: publisher.username,
    listingCount: publisher._count.properties,
  };
}
