/** Injection token for how far apart one owner's listings are pushed in the feed. */
export const FEED_SPREAD_HOURS = 'FEED_SPREAD_HOURS';

const DEFAULT_SPREAD_HOURS = 3;

/**
 * `FEED_OWNER_SPREAD_HOURS`: an owner's 2nd newest listing is ranked this many
 * hours older than it was published, the 3rd twice that, and so on, so a burst
 * of listings is mixed in with other people's instead of filling the screen.
 */
export function readFeedSpreadHours(raw = process.env.FEED_OWNER_SPREAD_HOURS) {
  if (raw === undefined || raw === '') return DEFAULT_SPREAD_HOURS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(
      `FEED_OWNER_SPREAD_HOURS must be a number above 0, got "${raw}"`,
    );
  }
  return hours;
}
