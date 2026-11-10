import {
  INestApplication,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import { API_VERSIONS, ApiVersions } from './api-versions';

/**
 * Serves each route under the versions in its path: `/v1/properties`.
 *
 * A handler without `@Version` answers every served version, so adding a
 * version only means writing the handlers that change. A changed endpoint
 * keeps its old handler with `@Version('1')` next to the new `@Version('2')`.
 *
 * Unversioned paths are answered too, so the services and the gateway can be
 * deployed in any order: a gateway from before versioning still forwards
 * `/properties`. Controllers that are not part of the app's API (`/internal`,
 * `/health`) are only ever unversioned (`VERSION_NEUTRAL`).
 */
export function enableApiVersioning(
  app: INestApplication,
  versions: ApiVersions = API_VERSIONS,
) {
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [VERSION_NEUTRAL, ...versions.served],
  });
}
