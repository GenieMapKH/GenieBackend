/** Statuses a listing comes back from as a new listing: it was off the market. */
const BACK_ON_THE_MARKET_FROM = ['Sold', 'Expired'];

/**
 * Whether a listing going live from `from` is dated as new in the feed:
 * only when it comes back after being sold or expired. One taken back to a
 * draft and published again keeps its first date, so unpublishing cannot
 * push a listing back to the top of the feed.
 */
export function datesAnew(from: string): boolean {
  return BACK_ON_THE_MARKET_FROM.includes(from);
}

/** The `publishedAt` of a listing going live from `from`, now holding `current`. */
export function publishedAtGoingLive(
  from: string,
  current: Date | null,
  now: Date = new Date(),
): Date {
  return current === null || datesAnew(from) ? now : current;
}
