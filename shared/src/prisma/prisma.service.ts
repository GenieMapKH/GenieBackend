import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@tilomnov/prisma-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { poolOptions } from './pool-options';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly keepsConnectionsOpen: boolean;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }
    // Each instance opens its own pool: instances x max must stay under the
    // database's connection limit.
    const options = poolOptions();
    super({
      adapter: new PrismaPg(new Pool({ connectionString, ...options })),
    });
    this.keepsConnectionsOpen = options.min > 0;
  }

  async onModuleInit() {
    await this.$connect();
    if (this.keepsConnectionsOpen) await this.warmUp();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Opens the pool's first connection now, so the first request does not
   * wait for it. A database that cannot be reached yet only delays that:
   * the service still starts.
   */
  private async warmUp() {
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.warn(
        `Could not open a database connection at start-up: ${(error as Error).message}`,
      );
    }
  }
}
