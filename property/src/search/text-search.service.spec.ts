import { FakeRedis, fakeCache } from '@tilomnov/shared/testing';
import { PublicPropertyCache } from '../properties/services/public-property-cache.service';
import { TextSearchService } from './text-search.service';

describe('TextSearchService', () => {
  let engine: {
    isConfigured: boolean;
    findListings: jest.Mock;
    findPublishers: jest.Mock;
  };
  let propertySearch: { matching: jest.Mock; byIds: jest.Mock };
  let peopleSearch: { matching: jest.Mock; byIds: jest.Mock };
  let service: TextSearchService;

  const byIdsInOrder = (ids: string[]) =>
    Promise.resolve(ids.map((id) => ({ id })));

  beforeEach(() => {
    engine = {
      isConfigured: true,
      findListings: jest.fn().mockResolvedValue(['p-2', 'p-1']),
      findPublishers: jest.fn().mockResolvedValue(['u-1']),
    };
    propertySearch = {
      matching: jest.fn().mockResolvedValue([{ id: 'db-1' }]),
      byIds: jest.fn().mockImplementation(byIdsInOrder),
    };
    peopleSearch = {
      matching: jest.fn().mockResolvedValue([{ id: 'db-u' }]),
      byIds: jest.fn().mockImplementation(byIdsInOrder),
    };
    service = new TextSearchService(
      engine as never,
      propertySearch as never,
      peopleSearch as never,
      new PublicPropertyCache(fakeCache(new FakeRedis())),
    );
  });

  it('reads the database alone when no engine is configured', async () => {
    engine.isConfigured = false;

    expect(await service.listings('villa', ['villa'], 8)).toEqual([
      { id: 'db-1' },
    ]);
    expect(await service.people('dara', ['dara'], 5)).toEqual([{ id: 'db-u' }]);
    expect(engine.findListings).not.toHaveBeenCalled();
  });

  it('keeps the engine ranking, read back from the database', async () => {
    const found = await service.listings('villa', ['villa'], 2);

    expect(engine.findListings).toHaveBeenCalledWith('villa', 2);
    expect(propertySearch.byIds).toHaveBeenCalledWith(['p-2', 'p-1']);
    expect(found).toEqual([{ id: 'p-2' }, { id: 'p-1' }]);
    expect(propertySearch.matching).not.toHaveBeenCalled();
  });

  it('answers from the database when the engine fails', async () => {
    engine.findListings.mockRejectedValue(new Error('connection refused'));
    engine.findPublishers.mockRejectedValue(new Error('connection refused'));

    expect(await service.listings('villa', ['villa'], 8)).toEqual([
      { id: 'db-1' },
    ]);
    expect(await service.people('dara', ['dara'], 5)).toEqual([{ id: 'db-u' }]);
  });

  it('does not fill up a short answer to Latin text', async () => {
    expect(await service.listings('villa', ['villa'], 8)).toHaveLength(2);
    expect(propertySearch.matching).not.toHaveBeenCalled();
  });

  it('fills up a short answer to Khmer text from the database, without repeats', async () => {
    engine.findListings.mockResolvedValue(['p-1']);
    propertySearch.matching.mockResolvedValue([
      { id: 'p-1' },
      { id: 'db-2' },
      { id: 'db-3' },
    ]);

    const found = await service.listings('ពេញ', ['ពេញ'], 3);

    expect(found).toEqual([{ id: 'p-1' }, { id: 'db-2' }, { id: 'db-3' }]);
  });

  it('fills up people found by Khmer text too', async () => {
    engine.findPublishers.mockResolvedValue([]);

    expect(await service.people('ដារ៉ា', ['ដារ៉ា'], 5)).toEqual([
      { id: 'db-u' },
    ]);
  });

  it('keeps a full answer to Khmer text as the engine ranked it', async () => {
    engine.findListings.mockResolvedValue(['p-1', 'p-2']);

    await service.listings('ផ្ទះ', ['ផ្ទះ'], 2);

    expect(propertySearch.matching).not.toHaveBeenCalled();
  });

  it('remembers listings found for the same text for a moment', async () => {
    await service.listings('villa', ['villa'], 8);
    await service.listings('villa', ['villa'], 8);

    expect(engine.findListings).toHaveBeenCalledTimes(1);
  });
});
