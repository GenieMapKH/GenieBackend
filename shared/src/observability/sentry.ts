import * as Sentry from '@sentry/nestjs';

/** Headers that carry a session or a service's secret: never sent to Sentry. */
const SECRET_HEADERS = ['authorization', 'cookie', 'x-guest-session-id'];

/**
 * Starts error reporting for [service] when `SENTRY_DSN` is set; without it
 * nothing is sent (a local run, tests). Call first thing in `main.ts`, after
 * `.env` is read and before anything else is imported, so Sentry can wrap the
 * libraries it instruments.
 *
 * Only errors the code did not expect are reported (see
 * [SentryErrorsModule]). Request bodies, cookies and session headers are left
 * out: they carry passwords, tokens and, for chat, sealed messages.
 */
export function initSentry(service: string): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    // Railway names the deployed commit; a local build has none.
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    serverName: service,
    initialScope: { tags: { service } },
    // Collected as little as helps fix a fault; [withoutSecrets] checks again.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: SECRET_HEADERS }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    // Performance tracing is off unless asked for (it is billed per event).
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0,
    beforeSend: (event) => withoutSecrets(event),
    beforeSendTransaction: (event) => withoutSecrets(event),
  });
  return true;
}

/** [event] without request bodies, cookies, query strings or session headers. */
export function withoutSecrets<T extends Sentry.Event>(event: T): T {
  const request = event.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SECRET_HEADERS.includes(name.toLowerCase())) {
          delete request.headers[name];
        }
      }
    }
  }
  if (event.user) event.user = { id: event.user.id };
  return event;
}
