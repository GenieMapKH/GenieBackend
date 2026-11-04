import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Browser origins allowed to call the API.
 *
 * - `CORS_ORIGINS` = comma-separated list of allowed origins.
 * - Not set, outside production: any origin (convenient for local web dev).
 * - Not set, in production: no browser origin. The mobile app is unaffected
 *   because native HTTP clients do not use CORS.
 */
/**
 * Request headers a browser may send besides the always-allowed ones. Each is
 * one the app sets; a header missing here makes the browser refuse the whole
 * request (the phone app is unaffected, as it does not use CORS).
 */
export const ALLOWED_REQUEST_HEADERS = [
  'Content-Type',
  'Accept',
  'Authorization',
  'X-Guest-Session-ID', // guest browsing
  'X-Device-Name', // sign-in: "Logged-in devices"
  'X-Device-Platform',
  'X-Device-Key', // sign-in: recognises a device that signed in before
  'If-None-Match', // asks again for a cached answer
];

export function buildCorsOptions(
  env: NodeJS.ProcessEnv = process.env,
): CorsOptions {
  const allowedOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origin =
    allowedOrigins.length > 0 ? allowedOrigins : env.NODE_ENV !== 'production';

  return {
    origin,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ALLOWED_REQUEST_HEADERS.join(','),
    // The app keeps answers by ETag; a browser hides it unless exposed.
    exposedHeaders: 'ETag',
  };
}
