/**
 * The versions of the public API (`/v1/...`). One list for the gateway, which
 * routes them, the services, which serve them, and chat's WebSocket, so they
 * never disagree. How to add or retire one: docs/API_VERSIONING.md.
 */
export interface ApiVersions {
  /** Versions that are answered, oldest first. The last one is current. */
  served: readonly string[];
  /** Versions that were served once: the app is told to update. */
  retired: readonly string[];
  /**
   * The version of a request that names none: what app builds from before
   * versioning send. It is retired together with that version.
   */
  unversioned: string;
}

export const API_VERSIONS: ApiVersions = {
  served: ['1'],
  retired: [],
  unversioned: '1',
};

/**
 * The `code` answered to a retired version, over HTTP (status 410) and when a
 * WebSocket is refused. The app shows "Update required" for it.
 */
export const API_VERSION_RETIRED = 'api_version_retired';

/** `deprecated` is still served, but a newer version exists. */
export type ApiVersionStatus = 'current' | 'deprecated' | 'retired' | 'unknown';

export function apiVersionStatus(
  version: string,
  versions: ApiVersions = API_VERSIONS,
): ApiVersionStatus {
  if (versions.retired.includes(version)) return 'retired';
  const index = versions.served.indexOf(version);
  if (index < 0) return 'unknown';
  return index === versions.served.length - 1 ? 'current' : 'deprecated';
}
