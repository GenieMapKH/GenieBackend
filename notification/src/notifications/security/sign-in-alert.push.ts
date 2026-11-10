import { inLocale, texts } from '../delivery/notification-texts';
import { PushContent, PushTarget } from '../delivery/push-sender';

/** Someone signed in to an account that was already signed in elsewhere. */
export interface SignInEvent {
  userId: string;
  /** The new session: its own device is not told about itself. */
  sessionId: string;
  deviceName?: string | null;
  platform?: string | null;
}

/** "Samsung SM-G991B (Android 14) signed in. If this wasn't you, ..." */
export function signInAlertPush(
  event: SignInEvent,
  target: PushTarget,
): PushContent {
  return {
    alert: {
      title: inLocale(texts.newSignInTitle, target.locale),
      body: inLocale(
        texts.newSignInBody,
        target.locale,
      )(describeDevice(event, target)),
    },
    data: { type: 'security_sign_in', sessionId: event.sessionId },
    channel: 'security',
    urgent: true,
  };
}

function describeDevice(event: SignInEvent, target: PushTarget): string {
  const name = event.deviceName?.trim();
  const platform = event.platform?.trim();
  if (name && platform) return `${name} (${platform})`;
  return name || platform || inLocale(texts.aNewDevice, target.locale);
}
