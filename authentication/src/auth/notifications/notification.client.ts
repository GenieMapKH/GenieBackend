import { Injectable, Logger } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';

/** Signing in never waits long for a push. */
const NOTIFY_TIMEOUT_MS = 5_000;

export interface SignInNotice {
  userId: string;
  /** The session that just started: its own device is not told about itself. */
  sessionId: string;
  deviceName: string | null;
  platform: string | null;
}

/**
 * Asks the notification service to warn an account's other devices. Never
 * throws and is never awaited: signing in must not depend on it.
 */
@Injectable()
export class NotificationClient {
  private readonly logger = new Logger(NotificationClient.name);
  private readonly client = new ServiceClient(
    'notification',
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4006',
    'authentication',
  );

  signIn(notice: SignInNotice): void {
    this.client
      .call('POST', '/internal/notifications/sign-in', {
        body: {
          userId: notice.userId,
          sessionId: notice.sessionId,
          ...(notice.deviceName && { deviceName: notice.deviceName }),
          ...(notice.platform && { platform: notice.platform }),
        },
        timeoutMs: NOTIFY_TIMEOUT_MS,
      })
      .catch((error: Error) =>
        this.logger.warn(`Sign-in push not sent: ${error.message}`),
      );
  }
}
