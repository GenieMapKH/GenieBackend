import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ReadPrisma, readPrismaFor } from './read-prisma';

/**
 * One shared database client (and connection pool) for the whole service,
 * and the client for public reads: a replica when `DATABASE_READ_URL` is set,
 * otherwise the same client.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: ReadPrisma, useFactory: readPrismaFor, inject: [PrismaService] },
  ],
  exports: [PrismaService, ReadPrisma],
})
export class PrismaModule {}
