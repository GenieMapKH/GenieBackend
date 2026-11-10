import { Logger } from '@nestjs/common';
import {
  PushContent,
  PushOutcome,
  PushSender,
  PushTarget,
} from './push-sender';

/**
 * Used when no Firebase service account is configured (a local run without
 * secrets): the service starts and records everything, but nothing is sent.
 * Tokens are never dropped because of it.
 */
export class DisabledPushSender extends PushSender {
  private readonly logger = new Logger(DisabledPushSender.name);
  private warned = false;

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(
    pushes: {
      token: string;
      platform: PushTarget['platform'];
      content: PushContent;
    }[],
  ): Promise<PushOutcome[]> {
    if (!this.warned) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON is not set: push notifications are not sent.',
      );
      this.warned = true;
    }
    return pushes.map(() => 'failed');
  }
}
