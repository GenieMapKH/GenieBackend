import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPair,
  randomUUID,
} from 'crypto';
import { promisify } from 'util';
import { LEGACY_SIGNING_KEY_ID } from '@tilomnov/shared';
import { SigningKeyCipher } from './signing-key-cipher';
import {
  planRotation,
  PUBLISH_LEAD_MS,
  rotationDays,
  RotationPlan,
} from './signing-key-policy';
import {
  SigningKeyRepository,
  SigningKeyRow,
  SigningKeyWrites,
} from './signing-key.repository';
import { LoadedSigningKey, SigningKeyStore } from './signing-key.store';

/** How often keys are re-read from the database (other replicas' rotations) and rotation is checked. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const generateRsaKeyPair = promisify(generateKeyPair);

/**
 * Creates, rotates and deletes the token signing keys by itself. On start
 * (which waits for it) and every few minutes: load the keys, create one when
 * none can sign or the current one is due, delete the ones nothing needs.
 */
@Injectable()
export class SigningKeyRotationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SigningKeyRotationService.name);
  private readonly cipher = SigningKeyCipher.fromEnv();
  private timer: NodeJS.Timeout | null = null;
  /** Keys already reported as undecryptable, so the log says it once, not every check. */
  private readonly undecryptable = new Set<string>();

  constructor(
    @Inject(SigningKeyRepository)
    private readonly repository: SigningKeyRepository,
    @Inject(SigningKeyStore) private readonly store: SigningKeyStore,
  ) {}

  /** No key, no sign-in: a failure here stops the service from starting. */
  async onModuleInit(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => {
      this.check().catch((error: Error) =>
        this.logger.error(`Signing key check failed: ${error.message}`),
      );
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(now = new Date()): Promise<void> {
    let loaded = this.load(await this.repository.findAll());
    const plan = this.plan(loaded, now);
    if (plan.create || plan.deleteKids.length > 0) {
      // Generated before the lock: it takes a moment, and other replicas wait on the lock.
      const candidate = plan.create
        ? await this.newKey(plan.create, now)
        : null;
      loaded = this.load(
        await this.repository.exclusively((writes) =>
          this.apply(writes, candidate, now),
        ),
      );
    }
    this.store.replace(loaded);
  }

  /** Re-plans under the lock: another replica may have rotated meanwhile. Returns the rows after. */
  private async apply(
    writes: SigningKeyWrites,
    candidate: SigningKeyRow | null,
    now: Date,
  ): Promise<SigningKeyRow[]> {
    const rows = await writes.findAll();
    if (rows.length === 0) {
      const legacy = legacyKey(now);
      if (legacy) {
        await writes.insert(legacy);
        this.logger.log(
          'Imported JWT_PUBLIC_KEY to verify tokens from before rotation',
        );
      }
    }
    const plan = this.plan(this.load(rows), now);
    if (plan.create && candidate) {
      await writes.insertSuccessor({
        ...candidate,
        activatesAt: activation(plan.create, now),
      });
      this.logger.log(
        `Created signing key ${candidate.kid} (${plan.create === 'now' ? 'signing now' : 'signs in 1 hour'})`,
      );
    }
    if (plan.deleteKids.length > 0) {
      await writes.delete(plan.deleteKids);
      this.logger.log(
        `Deleted expired signing keys: ${plan.deleteKids.join(', ')}`,
      );
    }
    return writes.findAll();
  }

  private plan(keys: LoadedSigningKey[], now: Date): RotationPlan {
    const usable = new Set(
      keys.filter((key) => key.privateKey).map((key) => key.kid),
    );
    return planRotation(keys, usable, now, rotationDays());
  }

  private async newKey(
    when: 'now' | 'scheduled',
    now: Date,
  ): Promise<SigningKeyRow> {
    const kid = randomUUID();
    const { publicKey, privateKey } = await generateRsaKeyPair('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return {
      kid,
      publicKey,
      privateKeyEncrypted: this.cipher.encrypt(privateKey, kid),
      activatesAt: activation(when, now),
      retiredAt: null,
    };
  }

  /** Parses the rows. A private key this process cannot decrypt is left out (and logged). */
  private load(rows: SigningKeyRow[]): LoadedSigningKey[] {
    return rows.map((row) => ({
      kid: row.kid,
      hasPrivateKey: row.privateKeyEncrypted !== null,
      activatesAt: row.activatesAt,
      retiredAt: row.retiredAt,
      publicKey: createPublicKey(row.publicKey),
      privateKey: this.decrypt(row),
    }));
  }

  private decrypt(
    row: SigningKeyRow,
  ): ReturnType<typeof createPrivateKey> | null {
    if (!row.privateKeyEncrypted) return null;
    try {
      return createPrivateKey(
        this.cipher.decrypt(row.privateKeyEncrypted, row.kid),
      );
    } catch {
      if (this.undecryptable.has(row.kid)) return null;
      this.undecryptable.add(row.kid);
      this.logger.warn(
        `Signing key ${row.kid} cannot be decrypted with this JWT_KEY_ENCRYPTION_KEY; it only verifies`,
      );
      return null;
    }
  }
}

function activation(when: 'now' | 'scheduled', now: Date): Date {
  return new Date(now.getTime() + (when === 'now' ? 0 : PUBLISH_LEAD_MS));
}

/**
 * The key tokens were signed with before rotation (`JWT_PUBLIC_KEY`), kept so
 * nobody is signed out by the switch. Retired at once: it never signs again,
 * and is unpublished once the last access token it signed has expired.
 */
function legacyKey(now: Date): SigningKeyRow | null {
  const pem = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n').trim();
  if (!pem) return null;
  return {
    kid: LEGACY_SIGNING_KEY_ID,
    publicKey: createPublicKey(pem)
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    privateKeyEncrypted: null,
    activatesAt: now,
    retiredAt: now,
  };
}
