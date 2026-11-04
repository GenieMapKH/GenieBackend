import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OwnListingsPageQuery } from '../dto/own-listings-page.query';
import { OwnerListingsService } from './owner-listings.service';

function parse(plain: object) {
  const query = plainToInstance(OwnListingsPageQuery, plain);
  const errors = validateSync(query, { whitelist: true }).map(
    (e) => e.property,
  );
  return { query, errors };
}

describe('OwnListingsPageQuery', () => {
  it('reads a comma-separated status list', () => {
    const { query, errors } = parse({ limit: '20', status: 'Draft,Expired' });
    expect(errors).toEqual([]);
    expect(query.status).toEqual(['Draft', 'Expired']);
  });

  it('is fine without a status', () => {
    expect(parse({ limit: '20' }).errors).toEqual([]);
  });

  it.each(['Deleted', 'Active,anything', ''])('refuses status %p', (status) => {
    expect(parse({ limit: '20', status }).errors).toEqual(['status']);
  });
});

describe('OwnerListingsService.page', () => {
  const prisma = {
    property: { findMany: jest.fn(), groupBy: jest.fn() },
  };
  const counts = { attach: jest.fn((rows: unknown[]) => rows) };
  let service: OwnerListingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.property.findMany.mockResolvedValue([{ id: 'a' }]);
    prisma.property.groupBy.mockResolvedValue([
      { status: 'Active', _count: { _all: 3 } },
      { status: 'Draft', _count: { _all: 1 } },
    ]);
    service = new OwnerListingsService(prisma as never, counts as never);
  });

  it('lists only the statuses asked for, but counts every status', async () => {
    const page = await service.page('u1', { limit: 20, offset: 0 }, [
      'Draft',
      'Expired',
    ]);

    const findArgs = prisma.property.findMany.mock.calls[0][0];
    expect(findArgs.where).toEqual({
      userId: 'u1',
      status: { in: ['Draft', 'Expired'] },
    });
    expect(prisma.property.groupBy.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      status: { not: 'Deleted' },
    });
    expect(page.countByStatus).toEqual({ Active: 3, Draft: 1 });
  });

  it('lists every status but deleted without a filter', async () => {
    await service.page('u1', { limit: 20, offset: 0 });

    expect(prisma.property.findMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      status: { not: 'Deleted' },
    });
  });
});
