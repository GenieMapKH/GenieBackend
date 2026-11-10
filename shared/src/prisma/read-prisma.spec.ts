import { readPrismaFor } from './read-prisma';
import { PrismaService } from './prisma.service';

describe('readPrismaFor', () => {
  const primary = {} as PrismaService;

  it('is the primary client itself when no replica is set', () => {
    expect(readPrismaFor(primary, {})).toBe(primary);
    expect(readPrismaFor(primary, { DATABASE_READ_URL: '' })).toBe(primary);
  });

  it('is a separate client of the replica when DATABASE_READ_URL is set', async () => {
    const replica = readPrismaFor(primary, {
      DATABASE_READ_URL: 'postgresql://reader@replica.invalid:5432/tilomnov',
    });

    expect(replica).not.toBe(primary);
    expect(typeof replica.property.findMany).toBe('function');
    await replica.$disconnect();
  });
});
