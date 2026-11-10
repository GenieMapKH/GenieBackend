import { Socket } from 'socket.io';
import {
  API_VERSION_RETIRED,
  API_VERSIONS,
  ApiVersions,
  apiVersionStatus,
} from '@tilomnov/shared/api-versions';

/** Refusal for a version this server does not know yet (an app newer than the server). */
export const API_VERSION_UNKNOWN = 'api_version_unknown';

/**
 * The API version a socket speaks, from socket.io's `auth.apiVersion`. The
 * events it sends and receives follow that version, as HTTP paths do. App
 * builds from before versioning send none.
 */
export function socketApiVersion(
  client: Socket,
  versions: ApiVersions = API_VERSIONS,
): string {
  const version: unknown = client.handshake.auth?.apiVersion;
  return typeof version === 'string' && version !== ''
    ? version
    : versions.unversioned;
}

/**
 * Why the socket's version may not connect, as the handshake error the app
 * reads (`api_version_retired` asks the user to update), or null when it may.
 */
export function refuseApiVersion(
  client: Socket,
  versions: ApiVersions = API_VERSIONS,
): string | null {
  switch (apiVersionStatus(socketApiVersion(client, versions), versions)) {
    case 'retired':
      return API_VERSION_RETIRED;
    case 'unknown':
      return API_VERSION_UNKNOWN;
    default:
      return null;
  }
}
