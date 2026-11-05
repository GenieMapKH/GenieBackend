import { Injectable } from '@nestjs/common';
import { KeyObject } from 'crypto';
import { LEGACY_SIGNING_KEY_ID } from '@tilomnov/shared';
import { isKept, isPublished, SigningKeyDates } from './signing-key-policy';

/** A stored key, parsed. `privateKey` is null when this process cannot sign with it. */
export interface LoadedSigningKey extends SigningKeyDates {
  publicKey: KeyObject;
  privateKey: KeyObject | null;
}

/** One entry of the JWKS document. */
export type PublishedJwk = JsonWebKey & {
  kid: string;
  alg: 'RS256';
  use: 'sig';
};

/**
 * The signing keys, held in memory so signing and verifying never wait for
 * the database. `SigningKeyRotationService` refreshes it.
 */
@Injectable()
export class SigningKeyStore {
  private keys: LoadedSigningKey[] = [];

  replace(keys: LoadedSigningKey[]): void {
    this.keys = keys;
  }

  /** The key to sign with now: the newest active one this process can use. */
  signingKey(now = new Date()): LoadedSigningKey & { privateKey: KeyObject } {
    const usable = this.keys.filter(
      (key): key is LoadedSigningKey & { privateKey: KeyObject } =>
        key.privateKey !== null && key.activatesAt.getTime() <= now.getTime(),
    );
    const newest = usable.sort(
      (a, b) => b.activatesAt.getTime() - a.activatesAt.getTime(),
    )[0];
    if (!newest) throw new Error('No signing key loaded');
    return newest;
  }

  /** For tokens every service accepts (access, proof, internal): published keys only. */
  publishedKey(kid: string | undefined, now = new Date()): KeyObject | null {
    const key = this.find(kid);
    return key && isPublished(key, now) ? key.publicKey : null;
  }

  /** For refresh tokens: any key still kept, so rotation does not sign anyone out. */
  keptKey(kid: string | undefined, now = new Date()): KeyObject | null {
    const key = this.find(kid);
    return key && isKept(key, now) ? key.publicKey : null;
  }

  /** The public keys other services may verify with. */
  jwks(now = new Date()): { keys: PublishedJwk[] } {
    return {
      keys: this.keys
        .filter((key) => isPublished(key, now))
        .map((key) => ({
          ...key.publicKey.export({ format: 'jwk' }),
          kid: key.kid,
          alg: 'RS256',
          use: 'sig',
        })),
    };
  }

  /** Tokens from before rotation have no `kid`. */
  private find(kid: string | undefined): LoadedSigningKey | undefined {
    const id = kid ?? LEGACY_SIGNING_KEY_ID;
    return this.keys.find((key) => key.kid === id);
  }
}
