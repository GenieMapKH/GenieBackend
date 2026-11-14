import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService, phoneNumberVariants } from '@tilomnov/shared';
import {
  databaseCall,
  databaseFailure,
  isUniqueViolation,
} from '../database-call';

/** A row of the `account.users` table (column names are the database's snake_case). */
export interface UserRecord {
  id: string;
  email: string | null;
  phone: string | null;
  email_verified?: boolean;
  phone_verified?: boolean;
  password_hash: string;
  /**
   * False while `password_hash` is a value nobody can match: an account made
   * by Google sign-in whose owner has not chosen a password yet.
   */
  has_password: boolean;
  role: string;
  /** The unique handle. The database fills it in for a new account. */
  username: string | null;
  /** The name people see. */
  name: string | null;
  avatar_url: string | null;
  firebase_uid: string | null;
  /** ISO time, set while the owner has switched the account off. */
  deactivated_at: string | null;
  banned_at?: string | null;
}

export type NewUser = Partial<Omit<UserRecord, 'id' | 'username'>> &
  Pick<UserRecord, 'password_hash'>;
export type UserPatch = Partial<Omit<UserRecord, 'id'>>;

/**
 * How many times a new account is tried with a freshly generated handle. A
 * collision needs two of about a trillion random handles to match, so one
 * retry is already far more than will ever be used.
 */
const MAX_CREATE_ATTEMPTS = 5;

const USER_COLUMNS = {
  id: true,
  email: true,
  phone: true,
  emailVerified: true,
  phoneVerified: true,
  passwordHash: true,
  hasPassword: true,
  role: true,
  username: true,
  name: true,
  avatarUrl: true,
  firebaseUid: true,
  deactivatedAt: true,
  bannedAt: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_COLUMNS }>;

/** The form an email is stored and looked up in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** All reads and writes of the `users` table for the auth module. */
@Injectable()
export class UserRepository {
  private readonly logger = new Logger(UserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserRecord | null> {
    return this.findOne({ id }, tx);
  }

  /**
   * Emails are stored in lowercase, so `Foo@Gmail.com` and `foo@gmail.com` are one account.
   * An account made before that rule may still hold capitals, so a miss is retried ignoring case.
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = normalizeEmail(email);
    return (
      (await this.findOne({ email: normalized })) ??
      this.findByEmailIgnoringCase(normalized)
    );
  }

  /**
   * `phone` is E.164 (see `normalizePhoneNumber`). An account made before
   * numbers were normalized may hold another spelling of it, so those match too.
   */
  findByPhone(phone: string): Promise<UserRecord | null> {
    return this.findOne({ phone: { in: phoneNumberVariants(phone) } });
  }

  findByFirebaseUid(uid: string): Promise<UserRecord | null> {
    return this.findOne({ firebaseUid: uid });
  }

  /**
   * Creates the account. Its username is not passed in: the database gives
   * every new account a random handle (`user_` and 10 hex digits) that no
   * other account has, and the owner can change it later. In the unlikely
   * event that handle is taken the insert is simply tried again, which draws
   * a new one, instead of failing the sign-up as if the email were in use.
   */
  async create(user: NewUser): Promise<UserRecord> {
    const data = toUserData({
      ...user,
      ...(user.email ? { email: normalizeEmail(user.email) } : {}),
    }) as Prisma.UserCreateInput;
    for (let attempt = 1; ; attempt++) {
      try {
        const row = await this.prisma.user.create({
          data,
          select: USER_COLUMNS,
        });
        return toUserRecord(row);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw databaseFailure(this.logger, 'Failed to create user', error);
        }
        if (await this.identityTaken(data)) {
          throw new ConflictException('Email or phone already exists');
        }
        // Only the generated handle can have collided: draw another.
        if (attempt >= MAX_CREATE_ATTEMPTS) {
          throw databaseFailure(this.logger, 'Failed to create user', error);
        }
      }
    }
  }

  /** A concurrent phone change must not be overwritten by an older SMS challenge. */
  async verifyPhone(
    id: string,
    previousPhone: string | null,
    phone: string,
  ): Promise<void> {
    try {
      const result = await this.prisma.user.updateMany({
        where: { id, phone: previousPhone },
        data: { phone, phoneVerified: true },
      });
      if (result.count !== 1)
        throw new ConflictException('Account phone changed. Please try again.');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error))
        throw new ConflictException('Phone number is already taken');
      throw databaseFailure(this.logger, 'Failed to verify phone', error);
    }
  }

  async update(id: string, patch: UserPatch): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id, ...(patch.deactivated_at === null && { bannedAt: null }) },
        data: toUserData(patch),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email or phone already exists');
      }
      throw databaseFailure(this.logger, 'Failed to update user', error);
    }
  }

  /** The condition is in the write: concurrent first-password requests cannot replace a password. */
  async createInitialPassword(
    id: string,
    firebaseUid: string,
    passwordHash: string,
  ): Promise<void> {
    const { count } = await databaseCall(
      this.logger,
      'Failed to create password',
      () =>
        this.prisma.user.updateMany({
          where: {
            id,
            firebaseUid,
            hasPassword: false,
            bannedAt: null,
            deactivatedAt: null,
          },
          data: { passwordHash, hasPassword: true },
        }),
    );
    if (count !== 1)
      throw new ConflictException(
        'Use change password or password reset for an existing password',
      );
  }

  /**
   * Removes the account for good. The database deletes everything that belongs
   * to it with the row: sessions, listings, favourites, chat messages and keys.
   */
  async delete(id: string): Promise<void> {
    await databaseCall(this.logger, 'Failed to delete account', () =>
      this.prisma.user.deleteMany({ where: { id } }),
    );
  }

  /** Whether another account already has this email, phone or Google identity. */
  private async identityTaken(data: Prisma.UserCreateInput): Promise<boolean> {
    const owners: Prisma.UserWhereInput[] = [];
    if (data.email) owners.push({ email: data.email });
    if (data.phone) owners.push({ phone: data.phone });
    if (data.firebaseUid) owners.push({ firebaseUid: data.firebaseUid });
    if (owners.length === 0) return false;
    const count = await databaseCall(this.logger, 'Failed to create user', () =>
      this.prisma.user.count({ where: { OR: owners } }),
    );
    return count > 0;
  }

  /** Exact match ignoring case. LIKE patterns are avoided: `_` occurs in real addresses. */
  private async findByEmailIgnoringCase(
    normalized: string,
  ): Promise<UserRecord | null> {
    const rows = await databaseCall(
      this.logger,
      'Failed to look up user',
      () =>
        this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM account.users
          WHERE lower(email) = ${normalized}
          LIMIT 1`,
    );
    return rows.length > 0 ? this.findById(rows[0].id) : null;
  }

  private async findOne(
    where: Prisma.UserWhereInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<UserRecord | null> {
    const row = await databaseCall(this.logger, 'Failed to look up user', () =>
      tx.user.findFirst({ where, select: USER_COLUMNS }),
    );
    return row ? toUserRecord(row) : null;
  }
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    email_verified: row.emailVerified,
    phone_verified: row.phoneVerified,
    password_hash: row.passwordHash,
    has_password: row.hasPassword,
    role: row.role,
    username: row.username,
    name: row.name,
    avatar_url: row.avatarUrl,
    firebase_uid: row.firebaseUid,
    deactivated_at: row.deactivatedAt?.toISOString() ?? null,
    banned_at: row.bannedAt?.toISOString() ?? null,
  };
}

/** The Prisma fields of a patch. A key left out stays as it is; `null` clears it. */
function toUserData(patch: UserPatch): Prisma.UserUpdateManyMutationInput {
  const data: Prisma.UserUpdateManyMutationInput = {};
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.phone !== undefined) data.phone = patch.phone;
  if (patch.email_verified !== undefined)
    data.emailVerified = patch.email_verified;
  if (patch.phone_verified !== undefined)
    data.phoneVerified = patch.phone_verified;
  if (patch.password_hash !== undefined)
    data.passwordHash = patch.password_hash;
  if (patch.has_password !== undefined) data.hasPassword = patch.has_password;
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.username !== undefined) data.username = patch.username;
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.avatar_url !== undefined) data.avatarUrl = patch.avatar_url;
  if (patch.firebase_uid !== undefined) data.firebaseUid = patch.firebase_uid;
  if (patch.deactivated_at !== undefined) {
    data.deactivatedAt =
      patch.deactivated_at === null ? null : new Date(patch.deactivated_at);
  }
  if (patch.banned_at !== undefined)
    data.bannedAt = patch.banned_at === null ? null : new Date(patch.banned_at);
  return data;
}
