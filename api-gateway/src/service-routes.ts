import { RequestMethod } from '@nestjs/common';
import { versionedPaths } from './api-versions';

/** The services behind the gateway, each reachable at an internal URL. */
export interface ServiceUrls {
  auth: string;
  user: string;
  property: string;
  chat: string;
  payment: string;
  notification: string;
}

export function serviceUrlsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServiceUrls {
  return {
    auth: env.AUTH_SERVICE_URL || 'http://localhost:4001',
    user: env.USER_SERVICE_URL || 'http://localhost:4002',
    property: env.PROPERTY_SERVICE_URL || 'http://localhost:4003',
    chat: env.CHAT_SERVICE_URL || 'http://localhost:4004',
    payment: env.PAYMENT_SERVICE_URL || 'http://localhost:4005',
    notification: env.NOTIFICATION_SERVICE_URL || 'http://localhost:4006',
  };
}

/** Called by the payment provider, so it cannot carry a user JWT. */
export const PAYMENT_WEBHOOK = {
  path: '/payments/webhook',
  method: RequestMethod.POST,
};

export interface ServiceRoute {
  service: keyof ServiceUrls;
  /** Path prefixes, unversioned: `routesFor` adds the `/v1` forms. */
  prefixes: string[];
  /** True when a valid JWT is required (the gateway sets `x-user-id` from it). */
  authenticated: boolean;
  /** True for the one service that holds WebSocket connections. */
  websocket?: boolean;
  /** Exact routes that skip authentication even under an authenticated prefix. */
  exclude?: (typeof PAYMENT_WEBHOOK)[];
  /** Exact routes added to a public route set. */
  alsoPublic?: (typeof PAYMENT_WEBHOOK)[];
}

/**
 * Where each path goes. A service going down only takes its own paths with
 * it. The app calls them under a version (`/v1/auth/login`); app builds from
 * before versioning still call them without one.
 */
export const SERVICE_ROUTES: ServiceRoute[] = [
  // Login, register, refresh, password reset: no JWT yet.
  { service: 'auth', prefixes: ['/auth'], authenticated: false },
  // Public browsing: listings and search without signing in.
  { service: 'property', prefixes: ['/public'], authenticated: false },
  // The payment provider's webhook: no JWT, authenticated by signature.
  {
    service: 'payment',
    prefixes: [],
    authenticated: false,
    alsoPublic: [PAYMENT_WEBHOOK],
  },
  // Everything else needs a valid JWT of a device that is still signed in.
  {
    service: 'property',
    prefixes: ['/properties', '/search', '/feed'],
    authenticated: true,
  },
  {
    service: 'payment',
    prefixes: ['/payments'],
    authenticated: true,
    exclude: [PAYMENT_WEBHOOK],
  },
  {
    service: 'user',
    prefixes: ['/users', '/reports', '/admin'],
    authenticated: true,
  },
  {
    service: 'chat',
    prefixes: ['/chat'],
    authenticated: true,
    websocket: true,
  },
  {
    service: 'notification',
    prefixes: ['/notifications'],
    authenticated: true,
  },
];

/**
 * Each prefix as `/x` and `/x/...`, unversioned and under each known
 * version (`/v1/x`), for every HTTP method.
 */
export function routesFor(prefixes: string[]) {
  const paths = prefixes.flatMap((prefix) => versionedPaths(prefix));
  return paths.flatMap((prefix) => [
    { path: prefix, method: RequestMethod.ALL },
    { path: `${prefix}/{*path}`, method: RequestMethod.ALL },
  ]);
}

/** Exact routes, such as the payment webhook, in every versioned form. */
export function exactRoutesFor(routes: (typeof PAYMENT_WEBHOOK)[]) {
  return routes.flatMap(({ path, method }) =>
    versionedPaths(path).map((versioned) => ({ path: versioned, method })),
  );
}
