import { Prisma } from '@tilomnov/prisma-client';
import { ServiceName } from '../internal/service-token';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceMessage } from './message-contracts';

const SCHEMAS: Record<ServiceName, string> = {
  authentication: 'account',
  user: 'account',
  property: 'listing',
  chat: 'chat',
  payment: 'payment',
  notification: 'notification',
};

export class MessageBusyError extends Error {}

/** Identifiers come only from the service map; all message values are SQL parameters. */
export class MessageStore {
  private readonly outbox: Prisma.Sql;
  private readonly receipts: Prisma.Sql;

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: ServiceName,
  ) {
    const schema = SCHEMAS[service];
    this.outbox = Prisma.raw(`"${schema}"."service_outbox"`);
    this.receipts = Prisma.raw(`"${schema}"."service_message_receipts"`);
  }

  async ready(): Promise<void> {
    await this.prisma.$queryRaw`SELECT id FROM ${this.outbox} WHERE false`;
    await this.prisma
      .$queryRaw`SELECT event_id FROM ${this.receipts} WHERE false`;
  }

  async enqueue(
    message: ServiceMessage,
    key: string | null,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO ${this.outbox} (id, service, dedup_key, envelope, expires_at)
      VALUES (${message.id}::uuid, ${this.service}, ${key}, ${JSON.stringify(message)}::jsonb, ${new Date(message.expiresAt)})
      ON CONFLICT (service, dedup_key) DO NOTHING`;
  }

  /** The row lock survives until confirmation is recorded; a crash can safely republish. */
  dispatchOne(
    publish: (message: ServiceMessage) => Promise<void>,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<
          {
            id: string;
            envelope: ServiceMessage;
            attempts: number;
            expired: boolean;
          }[]
        >`
        SELECT id, envelope, attempts, expires_at <= now() AS expired FROM ${this.outbox}
        WHERE service = ${this.service} AND published_at IS NULL AND next_attempt_at <= now()
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`;
        if (!row) return false;
        try {
          if (!row.expired) await publish(row.envelope);
          await tx.$executeRaw`UPDATE ${this.outbox} SET published_at = now() WHERE id = ${row.id}::uuid`;
          return true;
        } catch {
          const delay = Math.min(60, 2 ** Math.min(row.attempts + 1, 6));
          await tx.$executeRaw`UPDATE ${this.outbox}
          SET attempts = attempts + 1, next_attempt_at = now() + ${delay} * interval '1 second'
          WHERE id = ${row.id}::uuid`;
          return false;
        }
      },
      { timeout: 10000 },
    );
  }

  /** Serializes duplicate deliveries across replicas, and commits a receipt only on success. */
  processOnce(
    message: ServiceMessage,
    handle: () => Promise<void>,
  ): Promise<void> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`${this.service}:${message.id}`}, 9048)) AS locked`;
        if (!lock.locked) throw new MessageBusyError();
        const [receipt] = await tx.$queryRaw<{ id: string }[]>`
        SELECT event_id AS id FROM ${this.receipts} WHERE service = ${this.service} AND event_id = ${message.id}::uuid AND step = ''`;
        if (receipt) return;
        await handle();
        await tx.$executeRaw`INSERT INTO ${this.receipts} (service, event_id) VALUES (${this.service}, ${message.id}::uuid)`;
      },
      { timeout: 120000, maxWait: 10000 },
    );
  }

  async cleanup(): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM ${this.outbox}
      WHERE service = ${this.service} AND published_at < now() - interval '7 days'`;
    await this.prisma.$executeRaw`DELETE FROM ${this.receipts}
      WHERE service = ${this.service} AND processed_at < now() - interval '30 days'`;
  }
}
