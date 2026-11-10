import { Injectable, Logger } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';

/** A push is a courtesy: never wait long for one. */
const NOTIFY_TIMEOUT_MS = 5_000;

/** The longest name the notification service accepts; a push only needs it readable. */
const MAX_NAME_LENGTH = 100;

const shortened = (name: string) => name.slice(0, MAX_NAME_LENGTH);

export interface ChatMessageNotice {
  recipientId: string;
  senderId: string;
  senderName: string;
  messageId: string;
  /** The sealed message, as stored: only the recipient's phone can open it. */
  ciphertext: string;
  nonce: string;
}

export interface CallNotice {
  callId: string;
  callerId: string;
  callerName: string;
  calleeId: string;
}

/**
 * Asks the notification service to tell someone's phones. It never throws
 * and is never awaited: a message is stored and a call rings over the open
 * connection whether or not the push goes out.
 */
@Injectable()
export class NotificationClient {
  private readonly logger = new Logger(NotificationClient.name);
  private readonly client = new ServiceClient(
    'notification',
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4006',
    'chat',
  );

  chatMessage(notice: ChatMessageNotice): void {
    this.post('chat-message', {
      ...notice,
      senderName: shortened(notice.senderName),
    });
  }

  callRinging(notice: CallNotice): void {
    this.post('call-ringing', {
      ...notice,
      callerName: shortened(notice.callerName),
    });
  }

  callEnded(notice: CallNotice & { missed: boolean }): void {
    this.post('call-ended', {
      ...notice,
      callerName: shortened(notice.callerName),
    });
  }

  private post(event: string, body: object): void {
    this.client
      .call('POST', `/internal/notifications/${event}`, {
        body,
        timeoutMs: NOTIFY_TIMEOUT_MS,
      })
      .catch((error: Error) =>
        this.logger.warn(`Push "${event}" not sent: ${error.message}`),
      );
  }
}
