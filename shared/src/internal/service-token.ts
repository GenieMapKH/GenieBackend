import * as jwt from 'jsonwebtoken';

/** The services that call each other. A token names its sender; a receiver names who it accepts. */
export type ServiceName =
  'user' | 'payment' | 'property' | 'chat' | 'authentication' | 'notification';

/** `typ` of a token one service signs for another. Never accepted as a user's token. */
export const SERVICE_TOKEN = 'service';

const SERVICE_TOKEN_TTL_SECONDS = 60;

/** An HMAC key shorter than this can be guessed offline from one captured token. */
const MIN_SECRET_LENGTH = 32;

function secret(): string {
  const value = process.env.INTERNAL_SERVICE_SECRET;
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `INTERNAL_SERVICE_SECRET (at least ${MIN_SECRET_LENGTH} characters) is required for calls between services`,
    );
  }
  return value;
}

/** A one-minute token proving the call comes from `issuer`. HS256 with the secret every service shares. */
export function signServiceToken(issuer: ServiceName): string {
  return jwt.sign({ iss: issuer, typ: SERVICE_TOKEN }, secret(), {
    algorithm: 'HS256',
    expiresIn: SERVICE_TOKEN_TTL_SECONDS,
  });
}

/**
 * `INTERNAL_SERVICE_SECRET_PREVIOUS`, while the secret is being replaced. Set
 * the old value there and the new one in `INTERNAL_SERVICE_SECRET` on every
 * service: calls signed with either pass while services redeploy one by one.
 * Remove it once all of them run on the new secret.
 */
function previousSecret(): string | null {
  const value = process.env.INTERNAL_SERVICE_SECRET_PREVIOUS;
  return value && value.length >= MIN_SECRET_LENGTH ? value : null;
}

/** The service that signed `token`. Throws when it is forged, expired, or not a service token. */
export function verifyServiceToken(token: string): ServiceName {
  const payload = verifyWithEitherSecret(token);
  if (
    typeof payload === 'string' ||
    payload.typ !== SERVICE_TOKEN ||
    typeof payload.iss !== 'string'
  ) {
    throw new Error('Not a service token');
  }
  return payload.iss as ServiceName;
}

function verifyWithEitherSecret(token: string): string | jwt.JwtPayload {
  try {
    return jwt.verify(token, secret(), { algorithms: ['HS256'] });
  } catch (error) {
    const previous = previousSecret();
    // Only a wrong signature is worth a second try; an expired token stays expired.
    if (
      !previous ||
      !(error instanceof jwt.JsonWebTokenError) ||
      error instanceof jwt.TokenExpiredError
    ) {
      throw error;
    }
    return jwt.verify(token, previous, { algorithms: ['HS256'] });
  }
}
