import { MapBounds } from '../../properties/services/public-property-cache.service';

/** One line of the "places" part of the results, like a map app's suggestion list. */
export interface PlaceSuggestion {
  placeId: string;
  /** "Veng Sreng Blvd" */
  primaryText: string;
  /** "Phnom Penh, Cambodia"; null when the provider gives none. */
  secondaryText: string | null;
}

/** A chosen place: where it is, and the area it covers on the map. */
export interface PlaceArea {
  placeId: string;
  name: string;
  address: string | null;
  center: { lat: number; lng: number };
  viewport: MapBounds;
  /** Real mapped rings in GeoJSON longitude/latitude order, never a viewport box. */
  boundary?: PlaceBoundary;
}

export interface PlaceBoundary {
  type: 'MultiPolygon';
  /** Polygons, each with an outer ring followed by any holes. */
  coordinates: number[][][][];
}

export interface PlaceLookupOptions {
  /**
   * Groups the suggestions and the final lookup of one search into one billed
   * session with the provider. Chosen by the app, a new one per search.
   */
  sessionToken?: string;
  /** 'en' or 'km'. */
  language: string;
}

export interface PlaceSuggestOptions extends PlaceLookupOptions {
  /** Places near this point are ranked first. */
  near?: { lat: number; lng: number };
}

/**
 * Finds places (roads, villages, districts, landmarks) by name. Search knows
 * only this contract, so the map provider can be swapped without touching it.
 */
export abstract class PlaceProvider {
  /** False when the provider has no credentials: search then shows listings and people only. */
  abstract readonly isConfigured: boolean;

  abstract suggest(
    input: string,
    options: PlaceSuggestOptions,
  ): Promise<PlaceSuggestion[]>;

  /** The place, or null when the provider does not know `placeId`. */
  abstract area(
    placeId: string,
    options: PlaceLookupOptions,
  ): Promise<PlaceArea | null>;
}
