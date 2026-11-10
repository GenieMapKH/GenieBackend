import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
} from '../auth.constants';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A signing key's dates, as stored. `hasPrivateKey` is false for the imported pre-rotation key. */
export interface SigningKeyDates {
  kid: string;
  hasPrivateKey: boolean;
  activatesAt: Date;
  retiredAt: Date | null;
}

/** How often a new key takes over signing. `JWT_KEY_ROTATION_DAYS`, 30 by default. */
export function rotationDays(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.JWT_KEY_ROTATION_DAYS);
  return Number.isFinite(days) && days >= 1 ? days : 30;
}

/**
 * A new key is published this long before it signs anything. Other services
 * fetch the published keys at least every 10 minutes, so by the time a token
 * carries the new `kid` they all know it.
 */
export const PUBLISH_LEAD_MS = 60 * MINUTE_MS;

/**
 * A retired key stays published until every short-lived token it signed has
 * expired (access tokens are the longest of those), plus a margin for clocks.
 */
const PUBLISHED_AFTER_RETIREMENT_MS =
  ACCESS_TOKEN_TTL_SECONDS * 1000 + 5 * MINUTE_MS;

/**
 * This service keeps a retired key until the refresh tokens it signed have
 * expired, so rotation never signs anyone out. Refresh tokens are only
 * accepted here and are also checked against their database row.
 */
const KEPT_AFTER_RETIREMENT_MS = (REFRESH_TOKEN_TTL_DAYS + 1) * DAY_MS;

/** Whether other services may verify tokens with this key (it is in the JWKS). */
export function isPublished(key: SigningKeyDates, now: Date): boolean {
  return (
    !key.retiredAt ||
    now.getTime() < key.retiredAt.getTime() + PUBLISHED_AFTER_RETIREMENT_MS
  );
}

/** Whether the key is still needed at all (for refresh tokens). Otherwise it is deleted. */
export function isKept(key: SigningKeyDates, now: Date): boolean {
  return (
    !key.retiredAt ||
    now.getTime() < key.retiredAt.getTime() + KEPT_AFTER_RETIREMENT_MS
  );
}

/** What the rotation should do now. */
export interface RotationPlan {
  /** Create a key: signing at once (`now`), or published first (`scheduled`). */
  create: 'now' | 'scheduled' | null;
  /** Keys past `isKept`. */
  deleteKids: string[];
}

/**
 * `usableKids` are the keys this process can sign with: it holds the
 * encryption key their private halves were stored under.
 */
export function planRotation(
  keys: SigningKeyDates[],
  usableKids: ReadonlySet<string>,
  now: Date,
  rotationPeriodDays: number,
): RotationPlan {
  const deleteKids = keys
    .filter((key) => !isKept(key, now))
    .map((key) => key.kid);
  const active = keys.filter(
    (key) => key.hasPrivateKey && key.activatesAt.getTime() <= now.getTime(),
  );
  const pending = keys.some(
    (key) => key.hasPrivateKey && key.activatesAt.getTime() > now.getTime(),
  );

  // Nothing this process can sign with: a first start, or a changed encryption key.
  if (!active.some((key) => usableKids.has(key.kid))) {
    return { create: 'now', deleteKids };
  }
  const newest = Math.max(...active.map((key) => key.activatesAt.getTime()));
  const due = now.getTime() - newest >= rotationPeriodDays * DAY_MS;
  return { create: due && !pending ? 'scheduled' : null, deleteKids };
}
