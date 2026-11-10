import * as bcrypt from 'bcrypt';
import { createHash, timingSafeEqual } from 'crypto';

/** Marks a stored hash made by `hashRefreshToken`, as opposed to an older bcrypt one. */
const SHA256_PREFIX = 'sha256:';

/**
 * What the database keeps of a refresh token. The token is a signed JWT with
 * a random id, so it cannot be guessed and a fast hash is as safe as a slow
 * one. bcrypt was used before: it took about 0.1 s of a small thread pool on
 * every refresh (once to check, once to hash the next token), and it reads
 * only the first 72 bytes, which are the same for most tokens of one user.
 */
export function hashRefreshToken(token: string): string {
  return SHA256_PREFIX + sha256(token);
}

/**
 * Whether `token` is the one `stored` was made from. Tokens issued before the
 * switch still carry a bcrypt hash until they are next refreshed (at most 30
 * days); each refresh stores the new token's hash the new way.
 */
export async function refreshTokenMatches(
  token: string,
  stored: string,
): Promise<boolean> {
  if (!stored.startsWith(SHA256_PREFIX)) {
    return bcrypt.compare(token, stored);
  }
  const expected = Buffer.from(stored.slice(SHA256_PREFIX.length), 'hex');
  const actual = Buffer.from(sha256(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
