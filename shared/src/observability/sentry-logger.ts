import { ConsoleLogger, LogLevel } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/** Keep Railway stdout, and optionally send application log messages to Sentry. */
export class SentryLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context = '',
    level: LogLevel = 'log',
    stream?: 'stdout' | 'stderr',
    stack?: unknown,
  ): void {
    super.printMessages(messages, context, level, stream, stack);
    if (process.env.SENTRY_ENABLE_LOGS !== 'true' || !Sentry.getClient())
      return;
    const severity = {
      log: 'info',
      warn: 'warn',
      error: 'error',
      debug: 'debug',
      verbose: 'trace',
      fatal: 'fatal',
    } as const;
    for (const message of messages) {
      // Objects can contain request bodies or credentials; forward only their message.
      const text =
        typeof message === 'string'
          ? message
          : message instanceof Error
            ? message.message
            : '[structured application log]';
      Sentry.logger[severity[level]](scrubLogText(text), {
        context: scrubLogText(context),
      });
    }
  }
}

export function scrubLogText(text: string): string {
  let clean = text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]');
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      value.length >= 8 &&
      /PASSWORD|SECRET|TOKEN|KEY|DATABASE.*URL|REDIS_URL|RABBITMQ_URL|FIREBASE.*JSON/i.test(
        name,
      )
    ) {
      clean = clean.split(value).join('[redacted]');
    }
  }
  return clean;
}
