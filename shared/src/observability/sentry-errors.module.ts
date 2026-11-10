import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';

/**
 * Reports every error a request ends in that the code did not expect (a
 * 500), and only those: a refused request (`HttpException`: 400, 401, 404 ...)
 * is an answer, not a fault. Answers stay as Nest writes them. Without
 * `initSentry` it sends nothing.
 */
@Module({
  imports: [SentryModule.forRoot()],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class SentryErrorsModule {}
