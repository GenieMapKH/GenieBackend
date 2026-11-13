import * as jwt from 'jsonwebtoken';
import { AuthKeySet, authKeySet } from './auth-key-set';
import { requireActiveSession } from './active-session';
import { UnauthorizedException } from '@nestjs/common';

/** `typ` claims of the tokens the authentication service signs. */
export const ACCESS_TOKEN = 'access';
/** "This user typed their password a moment ago." Valid for 5 minutes. */
export const PASSWORD_PROOF_TOKEN = 'password-proof';
/** A call from the authentication service itself, about the account in `sub`. */
export const INTERNAL_TOKEN = 'internal';

/**
 * Verifies a token signed by the authentication service and returns its
 * claims. Every kind is signed with the same keys, so the caller names the one
 * `type` it accepts: a 30-day refresh token must never pass as an access token.
 * Throws when the token is invalid, expired or of another type, and
 * `KeySetUnavailableError` when the keys cannot be loaded.
 */
export async function verifySignedToken(
  token: string,
  type: string,
  keys: AuthKeySet = authKeySet(),
): Promise<jwt.JwtPayload & { sub: string }> {
  const key = await keys.key(tokenKeyId(token));
  const payload = jwt.verify(token, key, { algorithms: ['RS256'] });
  if (typeof payload === 'string' || !payload.sub) {
    throw new Error('Token has no subject');
  }
  if (payload.typ !== type) {
    throw new Error(`Not a token of type "${type}"`);
  }
  if (type === ACCESS_TOKEN) {
    if (typeof payload.sid !== 'string' || !payload.sid)
      throw new UnauthorizedException('Sign in again');
    if (payload.role === 'admin' && payload.adminMfa !== true)
      throw new UnauthorizedException(
        'Administrator email verification required',
      );
    await requireActiveSession(token);
  }
  return payload as jwt.JwtPayload & { sub: string };
}

/** The `kid` in a token's header, without trusting anything else in it. Throws for a malformed token. */
export function tokenKeyId(token: string): string | undefined {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error('Malformed token');
  return decoded.header.kid;
}
