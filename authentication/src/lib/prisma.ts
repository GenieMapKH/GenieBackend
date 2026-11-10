import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@tilomnov/prisma-client';
import { PrismaPg } from '@prisma/adapter-pg';

const rawDatabaseUrl = process.env.DATABASE_URL;
const databaseUrl = (rawDatabaseUrl ?? '').trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

export const prismaClientOptions = { adapter };

export function createPrismaClient() {
  return new PrismaClient(prismaClientOptions);
}
