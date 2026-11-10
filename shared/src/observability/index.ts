/**
 * Error reporting, reached as `@tilomnov/shared/sentry`: light enough for the
 * gateway, and loadable before anything else in each `main.ts`.
 */
export { initSentry, withoutSecrets } from './sentry';
export { SentryLogger } from './sentry-logger';
export { SentryErrorsModule } from './sentry-errors.module';
