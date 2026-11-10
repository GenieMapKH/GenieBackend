import { Logger } from '@nestjs/common';
import { App, cert, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, Message, Messaging } from 'firebase-admin/messaging';
import {
  PushContent,
  PushOutcome,
  PushSender,
  PushTarget,
} from './push-sender';

/** Firebase answers these when a token no longer reaches any device. */
const GONE_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Delivers pushes through Firebase Cloud Messaging, with the service account
 * in `FIREBASE_SERVICE_ACCOUNT_JSON` (the same one authentication uses for
 * Google sign-in).
 */
export class FirebasePushSender extends PushSender {
  private readonly logger = new Logger(FirebasePushSender.name);

  constructor(private readonly messaging: Messaging) {
    super();
  }

  /** Null when no service account is configured. */
  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): FirebasePushSender | null {
    const json = env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!json) return null;
    const app: App = initializeApp(
      { credential: cert(JSON.parse(json) as ServiceAccount) },
      'notification',
    );
    return new FirebasePushSender(getMessaging(app));
  }

  async send(
    pushes: {
      token: string;
      platform: PushTarget['platform'];
      content: PushContent;
    }[],
  ): Promise<PushOutcome[]> {
    if (pushes.length === 0) return [];
    const batch = await this.messaging.sendEach(
      pushes.map((push) => toFirebaseMessage(push.token, push.content)),
    );
    return batch.responses.map((response) => {
      if (response.success) return 'sent';
      const code = response.error?.code ?? '';
      if (
        GONE_CODES.has(code) ||
        isMalformedToken(code, response.error?.message)
      )
        return 'unregistered';
      this.logger.warn(
        `Push not delivered: ${code} ${response.error?.message ?? ''}`,
      );
      return 'failed';
    });
  }
}

/** A token that is not one at all is reported as a generic invalid argument. */
function isMalformedToken(code: string, message = ''): boolean {
  return (
    code === 'messaging/invalid-argument' && /registration token/i.test(message)
  );
}

/** How [content] looks to each kind of device. Exported for tests. */
export function toFirebaseMessage(
  token: string,
  content: PushContent,
): Message {
  const { alert, data, channel, tag, urgent, timeToLiveSeconds } = content;
  return {
    token,
    data,
    notification: alert
      ? { title: alert.title, body: alert.body, imageUrl: alert.imageUrl }
      : undefined,
    android: {
      priority: urgent ? 'high' : 'normal',
      ttl:
        timeToLiveSeconds === undefined ? undefined : timeToLiveSeconds * 1000,
      collapseKey: tag,
      notification: alert
        ? {
            channelId: channel,
            tag,
            imageUrl: alert.imageUrl,
            defaultSound: true,
          }
        : undefined,
    },
    apns: {
      headers: {
        'apns-priority': urgent ? '10' : '5',
        ...(tag && { 'apns-collapse-id': tag }),
        ...(timeToLiveSeconds !== undefined && {
          'apns-expiration': String(
            Math.floor(Date.now() / 1000) + timeToLiveSeconds,
          ),
        }),
      },
      payload: {
        aps: alert
          ? { sound: 'default', threadId: tag }
          : { contentAvailable: true },
      },
    },
    webpush: {
      headers: {
        Urgency: urgent ? 'high' : 'normal',
        ...(timeToLiveSeconds !== undefined && {
          TTL: String(timeToLiveSeconds),
        }),
      },
      notification: alert
        ? { title: alert.title, body: alert.body, image: alert.imageUrl, tag }
        : undefined,
    },
  };
}
