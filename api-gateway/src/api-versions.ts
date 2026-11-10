import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';
import {
  API_VERSION_RETIRED,
  API_VERSIONS,
  ApiVersions,
  apiVersionStatus,
} from '@tilomnov/shared/api-versions';

/** `/v1/...`: the version is the path's first segment. */
const VERSION_SEGMENT = /^\/v(\d+)(?=[/?]|$)/;

/** The version a path names, or null for an unversioned one (`/properties`). */
export function versionInPath(path: string): string | null {
  return VERSION_SEGMENT.exec(path)?.[1] ?? null;
}

/**
 * Every form of `path` the gateway accepts: unversioned, as app builds from
 * before versioning send it, and under each served or retired version.
 * Other versions are not routed, so they are answered 404.
 */
export function versionedPaths(
  path: string,
  versions: ApiVersions = API_VERSIONS,
): string[] {
  const known = [...versions.served, ...versions.retired];
  return [path, ...known.map((version) => `/v${version}${path}`)];
}

/**
 * The path forwarded to a service: always versioned, so the services answer
 * an unversioned request exactly as the version it stands for.
 */
export function withVersion(
  path: string,
  versions: ApiVersions = API_VERSIONS,
): string {
  return versionInPath(path) ? path : `/v${versions.unversioned}${path}`;
}

/** A WebSocket handshake: socket.io has its own path, never rewritten. */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  return req.headers.upgrade?.toLowerCase() === 'websocket';
}

/**
 * Runs before authentication and the proxy. A retired version is answered
 * 410 with `code: api_version_retired`, which the app shows as "Update
 * required"; any other answer says which version it is in `API-Version`.
 */
export function createApiVersionMiddleware(
  versions: ApiVersions = API_VERSIONS,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const version = versionInPath(req.originalUrl) ?? versions.unversioned;
    if (apiVersionStatus(version, versions) === 'retired') {
      res.status(410).json({
        statusCode: 410,
        error: 'Gone',
        code: API_VERSION_RETIRED,
        message:
          'This version of the app is no longer supported. Please update the app.',
      });
      return;
    }
    res.setHeader('API-Version', version);
    next();
  };
}
