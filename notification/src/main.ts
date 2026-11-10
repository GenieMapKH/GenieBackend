import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Error reporting starts before the rest is loaded, so it can wrap it.
import { initSentry, SentryLogger } from '@tilomnov/shared/sentry';
initSentry('notification');

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { enableApiVersioning } from '@tilomnov/shared/api-versions';
import { warmUpAuthKeys } from '@tilomnov/shared';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new SentryLogger(),
  });

  // Routes answer as /v1/...: see docs/API_VERSIONING.md.
  enableApiVersioning(app);

  // Reject malformed bodies and drop any field a DTO does not declare.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // On SIGTERM (every deploy): stop accepting work and close the DB pool.
  app.enableShutdownHooks();

  // Internal service: it is only reached through the api-gateway, so no CORS.
  const port = process.env.PORT || 4006;
  // HOST=:: for private networks that only resolve to IPv6 (older Railway environments).
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  Logger.log(`Listening on ${host}:${port}`, 'Bootstrap');
  void warmUpAuthKeys().then((status) => Logger.log(status, 'Bootstrap'));
}
void bootstrap();
