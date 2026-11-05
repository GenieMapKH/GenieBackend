import { Injectable } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';

/** A row of `account.jwt_signing_keys`. */
export interface SigningKeyRow {
  kid: string;
  publicKey: string;
  /** NULL for the imported pre-rotation key, which only verifies. */
  privateKeyEncrypted: string | null;
  activatesAt: Date;
  retiredAt: Date | null;
}

/** The reads and writes one rotation does, inside its transaction. */
export interface SigningKeyWrites {
  findAll(): Promise<SigningKeyRow[]>;
  insert(key: SigningKeyRow): Promise<void>;
  /** Inserts `key` and retires every key that was signing before it activates. */
  insertSuccessor(key: SigningKeyRow): Promise<void>;
  delete(kids: string[]): Promise<void>;
}

/** Any number, the same in every replica: they take turns on it. */
const ROTATION_LOCK_ID = 7_431_005;

/** All reads and writes of the `jwt_signing_keys` table. */
@Injectable()
export class SigningKeyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<SigningKeyRow[]> {
    return readAll(this.prisma);
  }

  /**
   * Runs `work` while holding a lock no other replica of this service can
   * hold at the same time, so two replicas never create a key each.
   */
  exclusively<T>(work: (writes: SigningKeyWrites) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROTATION_LOCK_ID}::bigint)`;
      return work({
        findAll: () => readAll(tx),
        insert: async (key) => {
          await tx.jwtSigningKey.create({ data: key });
        },
        insertSuccessor: (key) => insertSuccessor(tx, key),
        delete: async (kids) => {
          if (kids.length === 0) return;
          await tx.jwtSigningKey.deleteMany({ where: { kid: { in: kids } } });
        },
      });
    });
  }
}

type Client = Pick<Prisma.TransactionClient, 'jwtSigningKey'>;

function readAll(client: Client): Promise<SigningKeyRow[]> {
  return client.jwtSigningKey.findMany({
    select: {
      kid: true,
      publicKey: true,
      privateKeyEncrypted: true,
      activatesAt: true,
      retiredAt: true,
    },
    orderBy: { activatesAt: 'asc' },
  });
}

async function insertSuccessor(
  client: Client,
  key: SigningKeyRow,
): Promise<void> {
  await client.jwtSigningKey.updateMany({
    where: { retiredAt: null, activatesAt: { lte: key.activatesAt } },
    data: { retiredAt: key.activatesAt },
  });
  await client.jwtSigningKey.create({ data: key });
}
