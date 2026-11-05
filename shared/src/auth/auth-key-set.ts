import { createPublicKey, JsonWebKey, KeyObject } from 'crypto';

/**
 * The `kid` of the key that signed tokens before keys rotated. Those tokens
 * carry no `kid`, so a token without one is checked against this key.
 */
export const LEGACY_SIGNING_KEY_ID = 'legacy';

/** Where the authentication service publishes its public keys, below its base URL. */
export const JWKS_PATH = '/v1/auth/.well-known/jwks.json';

/** Keys are fetched again this often, so a retired key stops verifying soon after it is unpublished. */
const REFRESH_AFTER_MS = 10 * 60 * 1000;
/** A token with an unknown `kid` fetches the keys again, at most this often (garbage tokens cannot flood the auth service). */
const UNKNOWN_KEY_COOLDOWN_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 3000;

/** No keys could be loaded at all: the authentication service is unreachable. Not the caller's fault. */
export class KeySetUnavailableError extends Error {}

/** The token names a key the authentication service does not publish. */
export class UnknownSigningKeyError extends Error {}

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/**
 * The public keys that verify tokens signed by the authentication service,
 * fetched from its JWKS endpoint and cached. When a refresh fails the cached
 * keys keep working, so a short auth outage does not sign anybody out.
 */
export class AuthKeySet {
  private keys = new Map<string, KeyObject>();
  private loadedAt = 0;
  private lastAttemptAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly fetchKeys: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** The key for a token's `kid`. Throws `UnknownSigningKeyError` or `KeySetUnavailableError`. */
  async key(kid: string | undefined): Promise<KeyObject> {
    const id = kid ?? LEGACY_SIGNING_KEY_ID;
    const stale = this.now() - this.loadedAt > REFRESH_AFTER_MS;
    // The cooldown also spaces out retries while the auth service is down,
    // so requests keep using the cached keys instead of each waiting on a timeout.
    const mayRetry = this.now() - this.lastAttemptAt > UNKNOWN_KEY_COOLDOWN_MS;
    if (mayRetry && (stale || !this.keys.has(id))) {
      await this.refresh().catch(() => undefined);
    }
    if (this.loadedAt === 0) {
      throw new KeySetUnavailableError(
        `Signing keys could not be loaded from ${this.url}`,
      );
    }
    const key = this.keys.get(id);
    if (!key) throw new UnknownSigningKeyError(`Unknown signing key "${id}"`);
    return key;
  }

  /** Loads the keys now. Concurrent callers share one request. */
  refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  /** How many keys are cached, for the startup log. */
  get size(): number {
    return this.keys.size;
  }

  private async load(): Promise<void> {
    this.lastAttemptAt = this.now();
    const response = await this.fetchKeys(this.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`${this.url} answered ${response.status}`);
    }
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    this.keys = parseKeys(body.keys ?? []);
    this.loadedAt = this.now();
  }
}

/** RS256 signing keys only; anything else in the set is ignored. */
function parseKeys(jwks: JsonWebKey[]): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  for (const jwk of jwks) {
    const { kid, kty, alg } = jwk as JsonWebKey & {
      kid?: string;
      alg?: string;
    };
    if (typeof kid !== 'string' || kty !== 'RSA' || alg !== 'RS256') continue;
    keys.set(kid, createPublicKey({ key: jwk, format: 'jwk' }));
  }
  return keys;
}

let shared: AuthKeySet | null = null;

/** The key set of this process, from `AUTH_SERVICE_URL`. */
export function authKeySet(env: NodeJS.ProcessEnv = process.env): AuthKeySet {
  if (!shared) {
    const base = (env.AUTH_SERVICE_URL || 'http://localhost:4001').replace(
      /\/+$/,
      '',
    );
    shared = new AuthKeySet(`${base}${JWKS_PATH}`);
  }
  return shared;
}

/**
 * Loads the keys at startup so the first request does not wait for them, and
 * says in the log whether that worked. Never throws: requests retry on their own.
 */
export async function warmUpAuthKeys(): Promise<string> {
  try {
    await authKeySet().refresh();
    return `Loaded ${authKeySet().size} token signing key(s) from the authentication service`;
  } catch (error) {
    return `Token signing keys not loaded yet (${(error as Error).message}); will retry on the first request. Is AUTH_SERVICE_URL set?`;
  }
}

/** Forgets this process's cached keys, so the next check fetches them again. For tests. */
export function resetAuthKeySet(): void {
  shared = null;
}
