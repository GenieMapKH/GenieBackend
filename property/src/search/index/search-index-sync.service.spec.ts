import { ListingChanges } from '../../properties/services/listing-changes.service';
import { ListingRow, PublisherRow } from './search-documents';
import {
  DocumentBatches,
  ListingDocument,
  PublisherDocument,
} from './search-engine';
import { SearchIndexSync } from './search-index-sync.service';

const CREATED = new Date('2026-10-01T00:00:00Z');

function listingRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 'p-1',
    userId: 'u-1',
    title: 'ផ្ទះលក់នៅភ្នំពេញ',
    description: null,
    propertyType: 'House',
    listingType: 'Sale',
    createdAt: CREATED,
    status: 'Active',
    user: { deactivatedAt: null },
    ...overrides,
  };
}

function publisherRow(overrides: Partial<PublisherRow> = {}): PublisherRow {
  return {
    id: 'u-1',
    name: 'Dara',
    username: 'dara',
    deactivatedAt: null,
    _count: { properties: 1 },
    ...overrides,
  };
}

async function collect<T>(batches: DocumentBatches<T>): Promise<T[][]> {
  const all: T[][] = [];
  for await (const batch of batches) all.push(batch);
  return all;
}

describe('SearchIndexSync', () => {
  let prisma: {
    property: { findUnique: jest.Mock; findMany: jest.Mock };
    user: { findUnique: jest.Mock; findMany: jest.Mock };
  };
  let engine: {
    isConfigured: boolean;
    saveListing: jest.Mock;
    removeListing: jest.Mock;
    savePublisher: jest.Mock;
    removePublisher: jest.Mock;
    replaceAll: jest.Mock;
  };
  let changes: ListingChanges;
  let sync: SearchIndexSync;

  beforeEach(() => {
    prisma = {
      property: {
        findUnique: jest.fn().mockResolvedValue(listingRow()),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(publisherRow()),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    engine = {
      isConfigured: true,
      saveListing: jest.fn(),
      removeListing: jest.fn(),
      savePublisher: jest.fn(),
      removePublisher: jest.fn(),
      replaceAll: jest.fn(),
    };
    changes = new ListingChanges({ changed: jest.fn() } as never);
    sync = new SearchIndexSync(prisma as never, engine as never, changes);
  });

  const changed = () =>
    sync.listingChanged({ id: 'p-1', userId: 'u-1', lat: 11.5, lng: 104.9 });

  it('listens to listing changes only when an engine is configured', async () => {
    engine.isConfigured = false;
    sync.onModuleInit();
    await changes.changed({ id: 'p-1', userId: 'u-1', lat: null, lng: null });
    expect(prisma.property.findUnique).not.toHaveBeenCalled();

    engine.isConfigured = true;
    sync.onModuleInit();
    await changes.changed({ id: 'p-1', userId: 'u-1', lat: null, lng: null });
    expect(engine.saveListing).toHaveBeenCalled();
  });

  it('indexes a published listing with what search matches on, and its owner', async () => {
    await changed();

    expect(engine.saveListing).toHaveBeenCalledWith({
      id: 'p-1',
      title: 'ផ្ទះលក់នៅភ្នំពេញ',
      description: '',
      propertyType: 'House',
      listingType: 'Sale',
      createdAt: CREATED.getTime(),
    });
    expect(engine.savePublisher).toHaveBeenCalledWith({
      id: 'u-1',
      name: 'Dara',
      username: 'dara',
      listingCount: 1,
    });
  });

  it.each([
    ['taken back to a draft', listingRow({ status: 'Draft' })],
    ['deleted', listingRow({ status: 'Deleted' })],
    ['sold', listingRow({ status: 'Sold' })],
    [
      'owned by a hidden account',
      listingRow({ user: { deactivatedAt: new Date() } }),
    ],
    ['gone from the database', null],
  ])('takes out a listing %s', async (_, row) => {
    prisma.property.findUnique.mockResolvedValue(row);

    await changed();

    expect(engine.removeListing).toHaveBeenCalledWith('p-1');
    expect(engine.saveListing).not.toHaveBeenCalled();
  });

  it.each([
    [
      'with nothing published any more',
      publisherRow({ _count: { properties: 0 } }),
    ],
    ['who hid their account', publisherRow({ deactivatedAt: new Date() })],
  ])('takes out an owner %s', async (_, row) => {
    prisma.user.findUnique.mockResolvedValue(row);

    await changed();

    expect(engine.removePublisher).toHaveBeenCalledWith('u-1');
  });

  it('never puts contact details in a publisher document', async () => {
    await changed();

    const select = prisma.user.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('email');
    expect(select).not.toHaveProperty('phone');
  });

  describe('reindexAll', () => {
    it('hands over published listings and publishers a batch at a time', async () => {
      prisma.property.findMany
        .mockResolvedValueOnce([
          listingRow({ id: 'p-1' }),
          listingRow({ id: 'p-2' }),
        ])
        .mockResolvedValueOnce([]);
      prisma.user.findMany
        .mockResolvedValueOnce([publisherRow()])
        .mockResolvedValueOnce([]);
      let handed: [ListingDocument[][], PublisherDocument[][]] = [[], []];
      engine.replaceAll.mockImplementation(async (listings, publishers) => {
        handed = [await collect(listings), await collect(publishers)];
      });

      await sync.reindexAll();

      expect(handed[0].flat().map((doc) => doc.id)).toEqual(['p-1', 'p-2']);
      expect(handed[1].flat().map((doc) => doc.id)).toEqual(['u-1']);
      expect(prisma.property.findMany.mock.calls[1][0]).toMatchObject({
        cursor: { id: 'p-2' },
        skip: 1,
      });
      expect(prisma.property.findMany.mock.calls[0][0].where).toMatchObject({
        status: 'Active',
      });
    });

    it('applies again a change made while the snapshot was taken', async () => {
      engine.replaceAll.mockImplementation(async () => {
        await changed();
        engine.saveListing.mockClear();
      });

      await sync.reindexAll();

      expect(engine.saveListing).toHaveBeenCalledTimes(1);
    });
  });
});
