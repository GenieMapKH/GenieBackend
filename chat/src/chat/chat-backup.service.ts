import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { JsonCache, PrismaService } from '@tilomnov/shared';
import { BackupSeal, MIN_BACKUP_SECRET_LENGTH } from './backup-seal';
import { publicKeyCacheKey } from './public-key-cache';

const ATTEMPTS_PER_ROUND = 5;
const FIRST_LOCK_MS = 15 * 60 * 1000;
const LONGEST_LOCK_MS = 24 * 60 * 60 * 1000;

/**
 * How long a backup locks after this many wrong PINs in a row: every 5th wrong
 * PIN locks it, for 15 minutes at first and twice as long each time, up to a day.
 * A 6-digit PIN therefore cannot be guessed by trying them all.
 */
export function lockDurationMs(failedAttempts: number): number {
  if (failedAttempts === 0 || failedAttempts % ATTEMPTS_PER_ROUND !== 0)
    return 0;
  const round = failedAttempts / ATTEMPTS_PER_ROUND;
  return Math.min(FIRST_LOCK_MS * 2 ** (round - 1), LONGEST_LOCK_MS);
}

/**
 * What a backup is locked with: the chat PIN every account has, or, for a
 * backup from the short time chats were locked with it, the account password.
 */
export type BackupProtection = 'pin' | 'password';

/** A key backup as a device uploads it. */
export interface NewKeyBackup {
  blob: string;
  salt: string;
  nonce: string;
  /** Derived from the PIN on the device; proves the PIN without revealing it. */
  verifier: string;
  /** Which secret the verifier and blob come from. Defaults to `pin`. */
  protectedBy?: BackupProtection;
}

/** How the owner shows an existing backup is theirs to replace. */
export interface BackupOwnerProof {
  /** Proof of the PIN of the backup. Required when there is one... */
  currentVerifier?: string;
  /**
   * ...unless the owner proved their account password instead: the way back
   * in for someone who forgot the PIN. A locked backup does not stop it.
   */
  provenByPassword?: boolean;
}

/** What may accompany a new backup. */
export interface SaveBackupOptions extends BackupOwnerProof {
  /** Resetting keys: the new public key, stored together with its backup. */
  identityPublicKey?: string;
}

interface BackupRow {
  blob: string;
  nonce: string;
  verifier: string;
  failedAttempts: number;
  lockedUntil: Date | null;
}

type UnlockOutcome =
  | { kind: 'missing' }
  | { kind: 'locked'; retryAfterMs: number }
  | { kind: 'wrong'; attemptsLeft: number }
  | { kind: 'open'; blob: string; nonce: string };

/** Stores each user's PIN-protected chat key and releases it only for the right PIN. */
@Injectable()
export class ChatBackupService {
  private readonly logger = new Logger(ChatBackupService.name);
  private seal?: BackupSeal;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: JsonCache,
  ) {}

  /**
   * Stores a backup, and with `identityPublicKey` the new public key it belongs
   * to. A backup that already exists is only replaced for its own PIN or the
   * account password: otherwise anyone holding an unlocked phone could swap in
   * keys of their own and read the account's chats from then on.
   */
  async save(
    userId: string,
    backup: NewKeyBackup,
    options: SaveBackupOptions = {},
  ) {
    const seal = this.requireSeal();
    if (!options.provenByPassword) {
      await this.requireCurrentPin(seal, userId, options.currentVerifier);
    }

    const stored = {
      blob: seal.wrap(userId, backup.blob),
      salt: backup.salt,
      nonce: backup.nonce,
      verifier: seal.verifierTag(userId, backup.verifier),
      protectedBy: backup.protectedBy ?? 'pin',
      failedAttempts: 0,
      lockedUntil: null,
    };

    await this.prisma.$transaction([
      this.prisma.chatKeyBackup.upsert({
        where: { userId },
        create: { userId, ...stored },
        update: stored,
      }),
      // A backup from before PIN attempts were counted is replaced, not kept beside the new one.
      this.prisma.user.update({
        where: { id: userId },
        data: {
          backupBlob: null,
          backupSalt: null,
          backupNonce: null,
          ...(options.identityPublicKey && {
            identityPublicKey: options.identityPublicKey,
          }),
        },
      }),
    ]);
    if (options.identityPublicKey) {
      await this.cache.delete(publicKeyCacheKey(userId));
    }
    return { success: true };
  }

  /**
   * What a device needs before asking for the PIN: the salt, and whether to
   * ask for the backup PIN or the account password. A backup made before PIN
   * attempts were counted is still returned whole, so the app can open it once
   * and save it again in the protected form.
   */
  async describe(userId: string) {
    const backup = await this.prisma.chatKeyBackup.findUnique({
      where: { userId },
      select: { salt: true, protectedBy: true },
    });
    if (backup)
      return { backupSalt: backup.salt, protectedBy: backup.protectedBy };

    const legacy = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { backupBlob: true, backupSalt: true, backupNonce: true },
    });
    if (!legacy?.backupBlob || !legacy.backupSalt || !legacy.backupNonce) {
      throw new NotFoundException('No backup found');
    }
    return {
      backupSalt: legacy.backupSalt,
      backupBlob: legacy.backupBlob,
      backupNonce: legacy.backupNonce,
      protectedBy: 'pin',
    };
  }

  /** Releases the encrypted key for the right PIN proof; every wrong one is counted. */
  async unlock(userId: string, verifier: string) {
    const seal = this.requireSeal();
    // The attempt is recorded inside the transaction, so the answer is thrown only after it commits.
    const outcome = await this.prisma.$transaction((tx) =>
      this.attempt(tx, seal, userId, verifier),
    );
    if (outcome.kind === 'missing') {
      throw new NotFoundException('No backup found');
    }
    const opened = this.openOrThrow(outcome);
    return {
      backupBlob: seal.unwrap(userId, opened.blob),
      backupNonce: opened.nonce,
    };
  }

  /** Passes when there is no backup yet, or `currentVerifier` proves its PIN. A wrong one is counted. */
  private async requireCurrentPin(
    seal: BackupSeal,
    userId: string,
    currentVerifier?: string,
  ): Promise<void> {
    const existing = await this.prisma.chatKeyBackup.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!existing) return;
    if (!currentVerifier) {
      throw new ForbiddenException(
        'The current PIN is required to replace or remove the chat key backup',
      );
    }

    const outcome = await this.prisma.$transaction((tx) =>
      this.attempt(tx, seal, userId, currentVerifier),
    );
    // Deleted in between: there is nothing left to protect.
    if (outcome.kind !== 'missing') this.openOrThrow(outcome);
  }

  /** The stored key for a right PIN; `403` for a wrong one, `429` while locked. */
  private openOrThrow(outcome: Exclude<UnlockOutcome, { kind: 'missing' }>) {
    switch (outcome.kind) {
      case 'locked':
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many wrong PINs',
            retryAfterSeconds: Math.ceil(outcome.retryAfterMs / 1000),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'wrong':
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Wrong PIN',
          attemptsLeft: outcome.attemptsLeft,
        });
      case 'open':
        return outcome;
    }
  }

  private async attempt(
    tx: Prisma.TransactionClient,
    seal: BackupSeal,
    userId: string,
    verifier: string,
  ): Promise<UnlockOutcome> {
    // The row lock makes simultaneous guesses wait for each other, so none escapes the count.
    const [row] = await tx.$queryRaw<BackupRow[]>`
      SELECT blob, nonce, verifier, failed_attempts AS "failedAttempts", locked_until AS "lockedUntil"
      FROM chat.chat_key_backups
      WHERE user_id = ${userId}::uuid
      FOR UPDATE`;
    if (!row) return { kind: 'missing' };

    const now = Date.now();
    if (row.lockedUntil && row.lockedUntil.getTime() > now) {
      return { kind: 'locked', retryAfterMs: row.lockedUntil.getTime() - now };
    }

    if (seal.matches(userId, verifier, row.verifier)) {
      if (row.failedAttempts > 0) {
        await tx.chatKeyBackup.update({
          where: { userId },
          data: { failedAttempts: 0, lockedUntil: null },
        });
      }
      return { kind: 'open', blob: row.blob, nonce: row.nonce };
    }

    const failedAttempts = row.failedAttempts + 1;
    const lockMs = lockDurationMs(failedAttempts);
    await tx.chatKeyBackup.update({
      where: { userId },
      data: {
        failedAttempts,
        lockedUntil: lockMs > 0 ? new Date(now + lockMs) : null,
      },
    });
    return lockMs > 0
      ? { kind: 'locked', retryAfterMs: lockMs }
      : {
          kind: 'wrong',
          attemptsLeft:
            ATTEMPTS_PER_ROUND - (failedAttempts % ATTEMPTS_PER_ROUND),
        };
  }

  /** Backups are refused rather than stored unsealed when the secret is missing. */
  private requireSeal(): BackupSeal {
    if (this.seal) return this.seal;

    const secret = process.env.CHAT_BACKUP_SECRET;
    if (!secret || secret.length < MIN_BACKUP_SECRET_LENGTH) {
      this.logger.error(
        `CHAT_BACKUP_SECRET is missing or shorter than ${MIN_BACKUP_SECRET_LENGTH} characters`,
      );
      throw new ServiceUnavailableException('Chat backup is not available');
    }
    return (this.seal = new BackupSeal(secret));
  }
}
