import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boundaryContains } from '../area-geometry';
import { PlaceArea, PlaceBoundary } from './place-provider';

interface NamedBoundary {
  name: string;
  level: number;
  geometry: PlaceBoundary;
}

let boundaries: NamedBoundary[] | undefined;

/** Match both name and location so namesakes and POIs never inherit an area. */
export function cambodiaBoundary(
  place: PlaceArea,
  types: string[],
): PlaceBoundary | undefined {
  const levels = types.includes('administrative_area_level_1')
    ? [1]
    : types.includes('administrative_area_level_2') ||
        types.includes('locality')
      ? [2]
      : types.some((type) =>
            [
              'administrative_area_level_3',
              'sublocality',
              'sublocality_level_1',
            ].includes(type),
          )
        ? [3]
        : [];
  if (levels.length === 0) return undefined;
  // shortcut: the 2018 snapshot omits new subdivisions; update it when newer licensed rings are available.
  boundaries ??= JSON.parse(
    readFileSync(join(__dirname, 'data/cambodia-boundaries.json'), 'utf8'),
  ) as NamedBoundary[];
  const matches = boundaries.filter(
    (boundary) =>
      levels.includes(boundary.level) &&
      nameKey(boundary.name) === nameKey(place.name) &&
      boundaryContains(boundary.geometry, place.center),
  );
  return matches.length === 1 ? matches[0].geometry : undefined;
}

function nameKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(
      /\b(province|district|municipality|commune|sangkat|khan|krong|khum|srok)\b/g,
      '',
    )
    .replace(/[^a-z0-9]/g, '');
  return [
    'chomchau',
    'choamchau',
    'chaomchau',
    'chomchao',
    'choamchao',
    'chaomchao',
  ].includes(key)
    ? 'chaomchau'
    : key;
}
