import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FakeRedis, fakeCache } from '@tilomnov/shared/testing';
import { PlaceArea } from './places/place-provider';
import { SearchService } from './search.service';
import { TextSearchService } from './text-search.service';

const VENG_SRENG: PlaceArea = {
  placeId: 'ChIJveng-sreng',
  name: 'Veng Sreng Blvd',
  address: 'Phnom Penh, Cambodia',
  center: { lat: 11.52, lng: 104.87 },
  viewport: { minLat: 11.5, maxLat: 11.54, minLng: 104.85, maxLng: 104.89 },
};

describe('SearchService', () => {
  let places: { isConfigured: boolean; suggest: jest.Mock; area: jest.Mock };
  let propertySearch: { matching: jest.Mock; byOwner: jest.Mock };
  let propertyQuery: { searchMap: jest.Mock };
  let people: { matching: jest.Mock; findProfile: jest.Mock };
  let redis: FakeRedis;
  let service: SearchService;

  beforeEach(() => {
    places = {
      isConfigured: true,
      suggest: jest.fn().mockResolvedValue([
        {
          placeId: VENG_SRENG.placeId,
          primaryText: 'Veng Sreng Blvd',
          secondaryText: null,
        },
      ]),
      area: jest.fn().mockResolvedValue(VENG_SRENG),
    };
    propertySearch = {
      matching: jest.fn().mockResolvedValue([{ id: 'p-1' }]),
      byOwner: jest.fn().mockResolvedValue([]),
    };
    propertyQuery = { searchMap: jest.fn().mockResolvedValue([]) };
    people = {
      matching: jest.fn().mockResolvedValue([{ id: 'u-1' }]),
      findProfile: jest.fn(),
    };
    redis = new FakeRedis();
    service = new SearchService(
      places,
      propertySearch as never,
      propertyQuery as never,
      people as never,
      new TextSearchService(
        { isConfigured: false } as never,
        propertySearch as never,
        people as never,
        {} as never,
      ),
      fakeCache(redis),
    );
  });

  describe('search', () => {
    it('returns places, listings and people for one text', async () => {
      const results = await service.search({ q: '  Veng  SRENG ' });

      expect(results.places).toHaveLength(1);
      expect(results.properties).toEqual([{ id: 'p-1' }]);
      expect(results.people).toEqual([{ id: 'u-1' }]);
      expect(places.suggest).toHaveBeenCalledWith(
        'veng sreng',
        expect.objectContaining({ language: 'en' }),
      );
      expect(propertySearch.matching).toHaveBeenCalledWith(
        ['veng', 'sreng'],
        8,
      );
    });

    it('asks nothing for a text shorter than two characters', async () => {
      expect(await service.search({ q: ' a ' })).toEqual({
        places: [],
        properties: [],
        people: [],
      });
      expect(await service.search({ q: '%%' })).toEqual({
        places: [],
        properties: [],
        people: [],
      });
      expect(places.suggest).not.toHaveBeenCalled();
      expect(propertySearch.matching).not.toHaveBeenCalled();
    });

    it('still returns listings and people when the place provider fails', async () => {
      places.suggest.mockRejectedValue(new Error('timeout'));

      const results = await service.search({ q: 'veng sreng' });

      expect(results.places).toEqual([]);
      expect(results.properties).toEqual([{ id: 'p-1' }]);
    });

    it('asks the provider once for the same text from the same city', async () => {
      await service.search({ q: 'Veng Sreng', lat: 11.5612, lng: 104.9281 });
      await service.search({ q: 'veng sreng', lat: 11.5523, lng: 104.9302 });

      expect(places.suggest).toHaveBeenCalledTimes(1);
    });

    it('skips places when the provider is not configured', async () => {
      places.isConfigured = false;

      expect((await service.search({ q: 'veng sreng' })).places).toEqual([]);
      expect(places.suggest).not.toHaveBeenCalled();
    });
  });

  describe('placeArea', () => {
    it('returns the place and the listings inside its area, nearest first', async () => {
      propertyQuery.searchMap.mockResolvedValue([
        { id: 'edge', lat: 11.539, lng: 104.888 },
        { id: 'centre', lat: 11.5201, lng: 104.8701 },
      ]);

      const result = await service.placeArea(
        VENG_SRENG.placeId,
        { session: 'session-token-1' },
        'viewer-1',
      );

      expect(result.place.name).toBe('Veng Sreng Blvd');
      expect(result.properties.map((p) => p.id)).toEqual(['centre', 'edge']);
      expect(propertyQuery.searchMap).toHaveBeenCalledWith(
        VENG_SRENG.viewport,
        'viewer-1',
      );
      expect(places.area).toHaveBeenCalledWith(VENG_SRENG.placeId, {
        language: 'en',
        sessionToken: 'session-token-1',
      });
    });

    it('looks a place up once, then serves it from the cache', async () => {
      await service.placeArea(VENG_SRENG.placeId, {});
      await service.placeArea(VENG_SRENG.placeId, {});

      expect(places.area).toHaveBeenCalledTimes(1);
    });

    it('is 404 for a place the provider does not know', async () => {
      places.area.mockResolvedValue(null);

      await expect(
        service.placeArea('ChIJunknown-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is 503 when the provider fails or is not configured', async () => {
      places.area.mockRejectedValue(new Error('500'));
      await expect(
        service.placeArea(VENG_SRENG.placeId, {}),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      places.isConfigured = false;
      await expect(
        service.placeArea(VENG_SRENG.placeId, {}),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('publisher', () => {
    it('returns the person and their listings', async () => {
      people.findProfile.mockResolvedValue({
        id: 'u-1',
        name: 'Agency',
        listingCount: 1,
      });
      propertySearch.byOwner.mockResolvedValue([{ id: 'p-1' }]);

      expect(await service.publisher('u-1')).toEqual({
        person: { id: 'u-1', name: 'Agency', listingCount: 1 },
        properties: [{ id: 'p-1' }],
      });
    });

    it('passes on 404 for someone who cannot be found', async () => {
      people.findProfile.mockRejectedValue(new NotFoundException());

      await expect(service.publisher('u-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
