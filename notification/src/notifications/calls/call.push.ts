import { inLocale, texts } from '../delivery/notification-texts';
import { PushContent, PushTarget } from '../delivery/push-sender';

/** A ringing call is useless once the caller has given up. */
export const RING_SECONDS = 45;

export interface CallEvent {
  callId: string;
  callerId: string;
  callerName: string;
  calleeId: string;
}

export interface CallEndedEvent extends CallEvent {
  /** Nobody answered: the callee is told they missed it. */
  missed: boolean;
}

/**
 * An ordinary "Dara is calling" notification on every device, shown by the
 * system even when the app is closed; it opens the app on the call. On
 * Android the app, when it can start, replaces it (same tag) with one that
 * rings full screen.
 */
export function incomingCallPush(
  event: CallEvent,
  target: PushTarget,
): PushContent {
  return {
    alert: {
      title: inLocale(texts.incomingCall, target.locale)(event.callerName),
      body: inLocale(texts.tapToAnswer, target.locale),
    },
    data: {
      type: 'call_incoming',
      callId: event.callId,
      callerId: event.callerId,
      callerName: event.callerName,
      sentAt: new Date().toISOString(),
    },
    channel: 'calls',
    tag: `call:${event.callId}`,
    urgent: true,
    timeToLiveSeconds: RING_SECONDS,
  };
}

/**
 * A missed call is announced on every device, replacing the ringing
 * notification (same tag). On Android a call answered or cancelled still
 * gets a silent push, so the app stops ringing; elsewhere it needs nothing.
 */
export function callEndedPush(
  event: CallEndedEvent,
  target: PushTarget,
): PushContent | null {
  const data = {
    type: 'call_ended',
    callId: event.callId,
    callerId: event.callerId,
    callerName: event.callerName,
    missed: String(event.missed),
  };
  if (event.missed) {
    return {
      alert: {
        title: inLocale(texts.missedCall, target.locale),
        body: inLocale(texts.missedCallFrom, target.locale)(event.callerName),
      },
      data,
      channel: 'missed_calls',
      tag: `call:${event.callId}`,
      // Android: at once, so the ringing stops when the caller gives up.
      urgent: target.platform === 'android',
    };
  }
  if (target.platform !== 'android') return null;
  return {
    data,
    channel: 'calls',
    tag: `call:${event.callId}`,
    urgent: true,
    timeToLiveSeconds: RING_SECONDS,
  };
}
