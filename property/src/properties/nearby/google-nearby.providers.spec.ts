import {
  GoogleNearbyPlaceProvider,
  GoogleRequestError,
  GoogleRouteDistanceProvider,
} from './google-nearby.providers';

function respond(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('Google nearby providers', () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    process.env.GOOGLE_PLACES_API_KEY = originalKey;
  });

  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    };
  };

  describe('places', () => {
    it('asks for the closest markets in the circle, with only the cheap fields', async () => {
      fetchMock.mockReturnValue(
        respond(200, {
          places: [
            {
              id: 'ChIJ1',
              displayName: { text: 'Phsar Thmei' },
              location: { latitude: 11.57, longitude: 104.92 },
            },
            { id: 'ChIJ2', displayName: { text: 'No location' } },
          ],
        }),
      );

      const found = await new GoogleNearbyPlaceProvider().findNearest(
        'market',
        { lat: 11.55, lng: 104.9 },
        5000,
        3,
      );

      const { url, headers, body } = sent();
      expect(url).toBe('https://places.googleapis.com/v1/places:searchNearby');
      expect(headers['X-Goog-Api-Key']).toBe('test-key');
      expect(headers['X-Goog-FieldMask']).toBe(
        'places.id,places.displayName,places.location',
      );
      expect(body).toMatchObject({
        includedTypes: ['market', 'supermarket'],
        maxResultCount: 3,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude: 11.55, longitude: 104.9 },
            radius: 5000,
          },
        },
      });
      expect(found).toEqual([
        {
          providerPlaceId: 'ChIJ1',
          name: 'Phsar Thmei',
          location: { lat: 11.57, lng: 104.92 },
        },
      ]);
    });

    it('treats an empty answer as nothing nearby', async () => {
      fetchMock.mockReturnValue(respond(200, {}));
      await expect(
        new GoogleNearbyPlaceProvider().findNearest(
          'hospital',
          { lat: 0, lng: 0 },
          5000,
          3,
        ),
      ).resolves.toEqual([]);
    });

    it('fails loudly on an error status (bad key, API not enabled)', async () => {
      fetchMock.mockReturnValue(respond(403, { error: {} }));
      await expect(
        new GoogleNearbyPlaceProvider().findNearest(
          'school',
          { lat: 0, lng: 0 },
          5000,
          3,
        ),
      ).rejects.toThrow(GoogleRequestError);
    });

    it('is not configured without a key', () => {
      process.env.GOOGLE_PLACES_API_KEY = '';
      expect(new GoogleNearbyPlaceProvider().isConfigured).toBe(false);
    });
  });

  describe('road distances', () => {
    it('reads one matrix answer back into request order, null where there is no road', async () => {
      fetchMock.mockReturnValue(
        respond(200, [
          {
            originIndex: 0,
            destinationIndex: 2,
            distanceMeters: 3100,
            duration: '540s',
            condition: 'ROUTE_EXISTS',
          },
          // Index 0 is left out of protobuf JSON.
          {
            originIndex: 0,
            distanceMeters: 800,
            duration: '150s',
            condition: 'ROUTE_EXISTS',
          },
          { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
        ]),
      );

      const distances = await new GoogleRouteDistanceProvider().roadDistances(
        { lat: 11.55, lng: 104.9 },
        [
          { lat: 11.56, lng: 104.9 },
          { lat: 11.57, lng: 104.9 },
          { lat: 11.58, lng: 104.9 },
        ],
      );

      const { url, headers, body } = sent();
      expect(url).toBe(
        'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      );
      expect(headers['X-Goog-FieldMask']).toContain('distanceMeters');
      expect(body.travelMode).toBe('DRIVE');
      expect(body.destinations).toHaveLength(3);
      expect(distances).toEqual([
        { meters: 800, seconds: 150 },
        null,
        { meters: 3100, seconds: 540 },
      ]);
    });

    it('makes no call for no destinations', async () => {
      await expect(
        new GoogleRouteDistanceProvider().roadDistances({ lat: 0, lng: 0 }, []),
      ).resolves.toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
