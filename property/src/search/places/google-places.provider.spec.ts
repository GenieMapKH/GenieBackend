import {
  GooglePlacesProvider,
  PlacesRequestError,
} from './google-places.provider';

function respond(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('GooglePlacesProvider', () => {
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

  it('turns predictions into suggestions and sends the key only as a header', async () => {
    fetchMock.mockReturnValue(
      respond(200, {
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJ1',
              text: { text: 'Veng Sreng Blvd, Phnom Penh' },
              structuredFormat: {
                mainText: { text: 'Veng Sreng Blvd' },
                secondaryText: { text: 'Phnom Penh' },
              },
            },
          },
          {
            placePrediction: {
              placeId: 'ChIJ2',
              text: { text: 'Veng Sreng Market' },
            },
          },
          { queryPrediction: {} },
        ],
      }),
    );

    const suggestions = await new GooglePlacesProvider().suggest('veng sreng', {
      language: 'km',
      sessionToken: 'token-123',
      near: { lat: 11.5, lng: 104.9 },
    });

    expect(suggestions).toEqual([
      {
        placeId: 'ChIJ1',
        primaryText: 'Veng Sreng Blvd',
        secondaryText: 'Phnom Penh',
      },
      {
        placeId: 'ChIJ2',
        primaryText: 'Veng Sreng Market',
        secondaryText: null,
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('test-key');
    expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
    expect(JSON.parse(init.body)).toMatchObject({
      input: 'veng sreng',
      languageCode: 'km',
      sessionToken: 'token-123',
      includedRegionCodes: ['kh'],
      locationBias: {
        circle: { center: { latitude: 11.5, longitude: 104.9 } },
      },
    });
  });

  it('reads a place with its viewport', async () => {
    fetchMock.mockReturnValue(
      respond(200, {
        id: 'ChIJ1',
        displayName: { text: 'Veng Sreng Blvd' },
        formattedAddress: 'Veng Sreng Blvd, Phnom Penh',
        location: { latitude: 11.52, longitude: 104.87 },
        viewport: {
          low: { latitude: 11.5, longitude: 104.85 },
          high: { latitude: 11.54, longitude: 104.89 },
        },
      }),
    );

    expect(
      await new GooglePlacesProvider().area('ChIJ1', { language: 'en' }),
    ).toEqual({
      placeId: 'ChIJ1',
      name: 'Veng Sreng Blvd',
      address: 'Veng Sreng Blvd, Phnom Penh',
      center: { lat: 11.52, lng: 104.87 },
      viewport: { minLat: 11.5, maxLat: 11.54, minLng: 104.85, maxLng: 104.89 },
    });
  });

  it('treats an unknown place as missing but an outage as an error', async () => {
    const provider = new GooglePlacesProvider();

    fetchMock.mockReturnValue(respond(404, { error: {} }));
    expect(await provider.area('ChIJmissing', { language: 'en' })).toBeNull();

    fetchMock.mockReturnValue(respond(500, { error: {} }));
    await expect(
      provider.area('ChIJ1', { language: 'en' }),
    ).rejects.toBeInstanceOf(PlacesRequestError);
  });

  it('attaches real boundaries to area selections in either UI language', async () => {
    fetchMock.mockReturnValue(
      respond(200, {
        id: 'kampot',
        displayName: { text: 'Kampot' },
        location: { latitude: 10.606, longitude: 104.181 },
        types: ['locality', 'political'],
      }),
    );
    const result = await new GooglePlacesProvider().area('kampot', {
      language: 'km',
      sessionToken: 'session-1',
    });
    expect(result?.boundary?.type).toBe('MultiPolygon');
    expect(result?.boundary?.coordinates[0][0].length).toBeGreaterThan(4);
    expect(String(fetchMock.mock.calls[0][0])).toContain('languageCode=en');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'sessionToken=session-1',
    );
  });

  it('asks nothing without a key', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    const provider = new GooglePlacesProvider();

    expect(provider.isConfigured).toBe(false);
    expect(await provider.suggest('veng', { language: 'en' })).toEqual([]);
    expect(await provider.area('ChIJ1', { language: 'en' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
