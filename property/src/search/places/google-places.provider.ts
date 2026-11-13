import { Injectable, Logger } from '@nestjs/common';
import { cambodiaBoundary } from './cambodia-boundaries';
import {
  PlaceArea,
  PlaceLookupOptions,
  PlaceProvider,
  PlaceSuggestOptions,
  PlaceSuggestion,
} from './place-provider';

const API_URL = 'https://places.googleapis.com/v1';

/** A search bar must not hang on the provider; past this the places part is skipped. */
const TIMEOUT_MS = 4000;

/** How far around the map's centre suggestions are favoured. */
const BIAS_RADIUS_METERS = 50_000;

/** Only the fields used below: Google bills by the fields asked for. */
const SUGGEST_FIELDS = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text',
  'suggestions.placePrediction.structuredFormat',
].join(',');
const AREA_FIELDS = 'id,displayName,formattedAddress,location,viewport,types';

interface LatLngJson {
  latitude: number;
  longitude: number;
}

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId: string;
      text?: { text: string };
      structuredFormat?: {
        mainText?: { text: string };
        secondaryText?: { text: string };
      };
    };
  }[];
}

interface PlaceResponse {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: LatLngJson;
  viewport?: { low: LatLngJson; high: LatLngJson };
  types?: string[];
}

/** The provider answered with an error status. */
export class PlacesRequestError extends Error {
  constructor(readonly status: number) {
    super(`Google Places answered ${status}`);
  }
}

/**
 * Google Places API (New), called from the server so its key never ships
 * inside the app. Needs `GOOGLE_PLACES_API_KEY` (a server key with the Places
 * API (New) enabled); `GOOGLE_PLACES_REGION_CODES` limits the countries
 * searched (default `kh`).
 */
@Injectable()
export class GooglePlacesProvider extends PlaceProvider {
  private readonly logger = new Logger(GooglePlacesProvider.name);
  private readonly apiKey = process.env.GOOGLE_PLACES_API_KEY ?? '';
  private readonly regionCodes = (
    process.env.GOOGLE_PLACES_REGION_CODES ?? 'kh'
  )
    .split(',')
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);

  constructor() {
    super();
    if (!this.apiKey) {
      this.logger.warn(
        'GOOGLE_PLACES_API_KEY is not set: search will not suggest places.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.apiKey !== '';
  }

  async suggest(
    input: string,
    options: PlaceSuggestOptions,
  ): Promise<PlaceSuggestion[]> {
    if (!this.isConfigured) return [];

    const body = {
      input,
      languageCode: options.language,
      includedRegionCodes: this.regionCodes,
      ...(options.sessionToken && { sessionToken: options.sessionToken }),
      ...(options.near && {
        locationBias: {
          circle: {
            center: { latitude: options.near.lat, longitude: options.near.lng },
            radius: BIAS_RADIUS_METERS,
          },
        },
      }),
    };
    const response = await this.request<AutocompleteResponse>(
      `${API_URL}/places:autocomplete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': SUGGEST_FIELDS,
        },
        body: JSON.stringify(body),
      },
    );

    return (response.suggestions ?? []).flatMap(
      ({ placePrediction: prediction }) => {
        if (!prediction) return [];
        const primaryText =
          prediction.structuredFormat?.mainText?.text ?? prediction.text?.text;
        if (!primaryText) return [];
        return [
          {
            placeId: prediction.placeId,
            primaryText,
            secondaryText:
              prediction.structuredFormat?.secondaryText?.text ?? null,
          },
        ];
      },
    );
  }

  async area(
    placeId: string,
    options: PlaceLookupOptions,
  ): Promise<PlaceArea | null> {
    if (!this.isConfigured) return null;

    const url = new URL(`${API_URL}/places/${encodeURIComponent(placeId)}`);
    // The boundary catalog uses English names; the app displays the localized suggestion.
    url.searchParams.set('languageCode', 'en');
    if (options.sessionToken)
      url.searchParams.set('sessionToken', options.sessionToken);

    let place: PlaceResponse;
    try {
      place = await this.request<PlaceResponse>(url.toString(), {
        headers: { 'X-Goog-FieldMask': AREA_FIELDS },
      });
    } catch (error) {
      // An unknown or malformed id is the caller's mistake, not an outage.
      if (
        error instanceof PlacesRequestError &&
        (error.status === 404 || error.status === 400)
      )
        return null;
      throw error;
    }
    if (!place.location) return null;

    const center = {
      lat: place.location.latitude,
      lng: place.location.longitude,
    };
    const viewport = place.viewport
      ? {
          minLat: place.viewport.low.latitude,
          maxLat: place.viewport.high.latitude,
          minLng: place.viewport.low.longitude,
          maxLng: place.viewport.high.longitude,
        }
      : {
          minLat: center.lat,
          maxLat: center.lat,
          minLng: center.lng,
          maxLng: center.lng,
        };

    const area: PlaceArea = {
      placeId: place.id,
      name: place.displayName?.text ?? place.formattedAddress ?? '',
      address: place.formattedAddress ?? null,
      center,
      viewport,
    };
    const boundary = cambodiaBoundary(area, place.types ?? []);
    return boundary ? { ...area, boundary } : area;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        'X-Goog-Api-Key': this.apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new PlacesRequestError(response.status);
    }
    return (await response.json()) as T;
  }
}
