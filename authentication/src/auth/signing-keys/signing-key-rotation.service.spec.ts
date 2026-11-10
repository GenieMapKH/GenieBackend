import { generateKeyPairSync, randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SigningKeyRotationService } from './signing-key-rotation.service';
import {
  SigningKeyRepository,
  SigningKeyRow,
  SigningKeyWrites,
} from './signing-key.repository';
import { SigningKeyStore } from './signing-key.store';
import { TokenSigner } from './token-signer.service';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** The table, in memory. `exclusively` runs one caller at a time, like the advisory lock. */
class MemoryRepository {
  rows: SigningKeyRow[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  findAll = async () => this.rows.map((row) => ({ ...row }));

  exclusively<T>(work: (writes: SigningKeyWrites) => Promise<T>): Promise<T> {
    const run = this.queue.then(() =>
      work({
        findAll: this.findAll,
        insert: async (key) => void this.rows.push({ ...key }),
        insertSuccessor: async (key) => {
          for (const row of this.rows) {
            if (!row.retiredAt && row.activatesAt <= key.activatesAt)
              row.retiredAt = key.activatesAt;
          }
          this.rows.push({ ...key });
        },
        delete: async (kids) =>
          void (this.rows = this.rows.filter((row) => !kids.includes(row.kid))),
      }),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }
}

describe('SigningKeyRotationService', () => {
  const env = { ...process.env };
  let repository: MemoryRepository;

  /** One replica of the authentication service. */
  function replica(encryptionKey: string) {
    process.env.JWT_KEY_ENCRYPTION_KEY = encryptionKey;
    const store = new SigningKeyStore();
    const rotation = new SigningKeyRotationService(
      repository as unknown as SigningKeyRepository,
      store,
    );
    return { store, rotation, signer: new TokenSigner(store) };
  }

  const ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const legacy = generateKeyPairSync('rsa', { modulusLength: 2048 });

  beforeEach(() => {
    repository = new MemoryRepository();
    process.env.JWT_PUBLIC_KEY = legacy.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
  });
  afterAll(() => (process.env = env));

  it('on first start, signs with a new key and keeps the old env key for tokens already out there', async () => {
    const { rotation, store, signer } = replica(ENCRYPTION_KEY);
    const now = new Date();
    await rotation.check(now);

    const kids = store.jwks(now).keys.map((key) => key.kid);
    expect(kids).toHaveLength(2);
    expect(kids).toContain('legacy');

    const token = signer.sign({ sub: 'u1', typ: 'access' }, 60);
    expect(jwt.decode(token, { complete: true })?.header.kid).not.toBe(
      'legacy',
    );

    // A refresh token from before rotation (no kid) still refreshes, so nobody is signed out.
    const oldRefresh = jwt.sign(
      { sub: 'u1', jti: 't1', typ: 'refresh' },
      legacy.privateKey,
      {
        algorithm: 'RS256',
        expiresIn: '30d',
      },
    );
    expect(signer.verifyRefreshToken<{ jti: string }>(oldRefresh).jti).toBe(
      't1',
    );
  });

  it('stops publishing the old env key once its access tokens have expired, but keeps it for refresh', async () => {
    const { rotation, store } = replica(ENCRYPTION_KEY);
    const start = new Date();
    await rotation.check(start);
    const later = new Date(start.getTime() + 21 * MINUTE);

    expect(store.publishedKey(undefined, later)).toBeNull();
    expect(store.keptKey(undefined, later)).not.toBeNull();
  });

  it('rotates by itself: publishes the successor an hour early, then switches without signing anyone out', async () => {
    const { rotation, store } = replica(ENCRYPTION_KEY);
    const start = new Date(Date.now() - 31 * DAY);
    await rotation.check(start);
    const first = store.signingKey(start).kid;

    const due = new Date(start.getTime() + 30 * DAY);
    await rotation.check(due);
    const successor = store
      .jwks(due)
      .keys.find((key) => key.kid !== first && key.kid !== 'legacy');
    expect(successor).toBeDefined();
    expect(store.signingKey(due).kid).toBe(first);

    const switched = new Date(due.getTime() + 61 * MINUTE);
    expect(store.signingKey(switched).kid).toBe(successor!.kid);
    // Access tokens from the old key keep working until they expire.
    expect(store.publishedKey(first, switched)).not.toBeNull();
  });

  it('creates exactly one key when two replicas start together', async () => {
    const a = replica(ENCRYPTION_KEY);
    const b = replica(ENCRYPTION_KEY);
    const now = new Date();

    await Promise.all([a.rotation.check(now), b.rotation.check(now)]);

    expect(
      repository.rows.filter((row) => row.privateKeyEncrypted),
    ).toHaveLength(1);
    expect(a.store.signingKey(now).kid).toBe(b.store.signingKey(now).kid);
  });

  it('starts signing with a fresh key when JWT_KEY_ENCRYPTION_KEY changes, and old tokens still verify', async () => {
    const before = replica(ENCRYPTION_KEY);
    const now = new Date();
    await before.rotation.check(now);
    const oldToken = before.signer.sign(
      { sub: 'u1', jti: 't1', typ: 'refresh' },
      '30d',
    );

    const after = replica(randomBytes(32).toString('base64'));
    await after.rotation.check(now);

    expect(after.store.signingKey(now).kid).not.toBe(
      before.store.signingKey(now).kid,
    );
    expect(after.signer.verifyRefreshToken<{ jti: string }>(oldToken).jti).toBe(
      't1',
    );
  });

  it('stores private keys only encrypted', async () => {
    await replica(ENCRYPTION_KEY).rotation.check(new Date());

    for (const row of repository.rows) {
      expect(row.privateKeyEncrypted ?? '').not.toContain('PRIVATE KEY');
    }
  });

  it('works without an old env key (everyone signs in again)', async () => {
    delete process.env.JWT_PUBLIC_KEY;
    const { rotation, store } = replica(ENCRYPTION_KEY);
    await rotation.check(new Date());

    expect(store.jwks().keys.map((key) => key.kid)).not.toContain('legacy');
  });
});
