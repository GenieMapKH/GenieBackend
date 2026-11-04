/** Where a notification goes: one device, as registered by the app. */
export interface PushTarget {
  /** Row id in `push_devices`. */
  id: string;
  token: string;
  platform: 'android' | 'ios' | 'web';
  locale: 'en' | 'km';
}

/** Android notification channels. Each must also be created by the app. */
export type PushChannel =
  | 'chat_messages'
  | 'security'
  | 'promotions'
  | 'calls'
  /** Quiet, unlike `calls`, whose sound is the ringtone. */
  | 'missed_calls'
  /** New listings someone asked to hear about: saved searches, people followed, price drops. */
  | 'listing_alerts';

/** One push, independent of the provider that delivers it. */
export interface PushContent {
  /** What the app reads to act on the push. Every value is a string. */
  data: Record<string, string>;
  /** Shown by the system. Without it the push is silent and the app handles it. */
  alert?: { title: string; body: string; imageUrl?: string };
  channel: PushChannel;
  /** A push with the same tag replaces the earlier one instead of adding another. */
  tag?: string;
  /** Delivered at once, even to a phone saving battery: calls, security alerts, chat. */
  urgent: boolean;
  /** Dropped if it cannot be delivered within this many seconds (a ringing call). */
  timeToLiveSeconds?: number;
}

/** What became of one push. */
export type PushOutcome = 'sent' | 'unregistered' | 'failed';

/**
 * Hands pushes to a delivery provider (Firebase Cloud Messaging). The
 * business rules only depend on this, so the provider can be swapped or faked.
 */
export abstract class PushSender {
  /** Most pushes one call to [send] may carry. */
  static readonly maxBatch = 500;

  /** One outcome per push, in the same order. Never throws for a single bad token. */
  abstract send(
    pushes: {
      token: string;
      platform: PushTarget['platform'];
      content: PushContent;
    }[],
  ): Promise<PushOutcome[]>;
}
