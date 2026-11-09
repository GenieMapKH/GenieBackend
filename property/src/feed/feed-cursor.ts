import { BadRequestException } from '@nestjs/common';
import { FEED_SORTS, FeedSort } from './feed-filters';

/** Where a feed page ends: the last listing's ranking time and id. */
export interface FeedCursor {
  feedAt: Date;
  id: string;
  sort?: FeedSort;
  sortValue?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opaque to the app: it only sends back what it was given. A listing
 * published while someone scrolls never shifts the pages after it, as an
 * offset would.
 */
export function encodeFeedCursor(cursor: FeedCursor): string {
  const order =
    cursor.sort && cursor.sort !== 'newest'
      ? `|${cursor.sort}|${cursor.sortValue}`
      : '';
  return Buffer.from(
    `${cursor.feedAt.toISOString()}|${cursor.id}${order}`,
  ).toString('base64url');
}

/** A 400 for anything this service did not hand out. */
export function decodeFeedCursor(raw: string): FeedCursor {
  const [time, id, ...rest] = Buffer.from(raw, 'base64url')
    .toString('utf8')
    .split('|');
  const feedAt = new Date(time ?? '');
  if (!id || !UUID.test(id) || isNaN(feedAt.getTime())) {
    throw new BadRequestException('Invalid cursor');
  }
  if (rest.length === 0) return { feedAt, id };
  const [sort, sortValue] = rest;
  if (
    rest.length !== 2 ||
    sort === 'newest' ||
    !FEED_SORTS.includes(sort as FeedSort) ||
    !/^-?\d{1,16}(\.\d{1,32})?$/.test(sortValue ?? '')
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  return { feedAt, id, sort: sort as FeedSort, sortValue };
}
