import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@tilomnov/prisma-client';
import { prismaClientOptions } from './lib/prisma';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super(prismaClientOptions);
  }
}
