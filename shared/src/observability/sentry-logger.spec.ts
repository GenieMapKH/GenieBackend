import { ConsoleLogger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { scrubLogText, SentryLogger } from './sentry-logger';

describe('Sentry application logs', () => {
  const saved = process.env;
  afterEach(() => {
    process.env = saved;
    jest.restoreAllMocks();
  });
  it('redacts configured secrets, database URL credentials and authorization tokens', () => {
    process.env = {
      ...saved,
      INTERNAL_SERVICE_SECRET: 'private-service-secret',
    };
    expect(
      scrubLogText(
        'private-service-secret postgres://alice:password@db/test Bearer jwt-token',
      ),
    ).toBe('[redacted] postgres://[redacted]@db/test Bearer [redacted]');
  });
  it('preserves stdout and sends message text, without serializing request objects', () => {
    process.env = { ...saved, SENTRY_ENABLE_LOGS: 'true' };
    const stdout = jest
      .spyOn(
        ConsoleLogger.prototype as unknown as {
          printMessages: (...args: unknown[]) => void;
        },
        'printMessages',
      )
      .mockImplementation(() => undefined);
    jest.spyOn(Sentry, 'getClient').mockReturnValue({
      getOptions: () => ({ enableLogs: true }),
    } as unknown as ReturnType<typeof Sentry.getClient>);
    const info = jest
      .spyOn(Sentry.logger, 'info')
      .mockImplementation(() => undefined);
    const logger = new SentryLogger();
    logger.log('Healthy', 'user');
    logger.log({ password: 'never-send-this' }, 'user');
    expect(stdout).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith('Healthy', { context: 'user' });
    expect(info).toHaveBeenCalledWith('[structured application log]', {
      context: 'user',
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('never-send-this');
  });
  it('does not send logs when collection is disabled', () => {
    jest
      .spyOn(
        ConsoleLogger.prototype as unknown as {
          printMessages: (...args: unknown[]) => void;
        },
        'printMessages',
      )
      .mockImplementation(() => undefined);
    jest.spyOn(Sentry, 'getClient').mockReturnValue(undefined);
    const info = jest.spyOn(Sentry.logger, 'info');
    new SentryLogger().log('local only');
    expect(info).not.toHaveBeenCalled();
  });
});
