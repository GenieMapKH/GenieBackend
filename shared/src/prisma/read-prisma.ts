import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@tilomnov/prisma-client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { poolOptions } from './pool-options';
import { PrismaService } from './prisma.service';

/**
 * The client for reads that may be a moment old: what every visitor sees
 * (the public map, search, public listing pages, publishers' profiles).
 * Anything read right after the caller's own write (their listings, chat,
 * sessions) uses `PrismaService`.
 *
 * With `DATABASE_READ_URL` set this is a replica, which can lag the primary
 * by a moment; without it, it is the primary client itself.
 */
export abstract class ReadPrisma extends PrismaClient {}

/** A client of the read replica, with its own pool. */
class ReplicaPrismaClient
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('ReadPrisma');

  constructor(connectionString: string) {
    super({
      adapter: new PrismaPg(new Pool({ connectionString, ...poolOptions() })),
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Public reads use the read replica (DATABASE_READ_URL)');
    } catch (error) {
      // Like the primary: an unreachable database delays the first read, not the start.
      this.logger.warn(
        `Could not reach the read replica at start-up: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** The replica when `DATABASE_READ_URL` is set, otherwise `primary` itself. */
export function readPrismaFor(
  primary: PrismaService,
  env: NodeJS.ProcessEnv = process.env,
): PrismaClient {
  const url = env.DATABASE_READ_URL;
  return url ? new ReplicaPrismaClient(url) : primary;
}
