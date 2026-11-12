import { ServiceName } from '../internal/service-token';

export const MESSAGE_ROUTES = {
  'notification.chat-message.v1': ['chat', 'notification'],
  'notification.sign-in.v1': ['authentication', 'notification'],
  'notification.saved-search-match.v1': ['property', 'notification'],
  'notification.followed-listing.v1': ['property', 'notification'],
  'notification.saved-listing-update.v1': ['property', 'notification'],
  'notification.publishing-expiry.v1': ['payment', 'notification'],
  'authentication.order-email.v1': ['payment', 'authentication'],
  'authentication.sign-in-email.v1': ['authentication', 'authentication'],
  'chat.user-blocked.v1': ['user', 'chat'],
  'property.account-visibility.v1': ['user', 'property'],
  'property.listing-went-live.v1': ['property', 'property'],
  'property.listing-price-dropped.v1': ['property', 'property'],
  'property.listing-sold.v1': ['property', 'property'],
} as const satisfies Record<string, readonly [ServiceName, ServiceName]>;

export type MessageType = keyof typeof MESSAGE_ROUTES;
export const SERVICES: ServiceName[] = [
  'authentication',
  'user',
  'property',
  'chat',
  'payment',
  'notification',
];
export const MESSAGE_MAX_AGE_MS = 7 * 86400000;
export const MESSAGE_MAX_BYTES = 256 * 1024;

export interface ServiceMessage {
  id: string;
  version: 1;
  type: MessageType;
  source: ServiceName;
  destination: ServiceName;
  createdAt: string;
  expiresAt: string;
  payload: object;
}

export class InvalidMessageError extends Error {}

export function decodeMessage(
  content: Buffer,
  destination: ServiceName,
): ServiceMessage {
  if (content.length > MESSAGE_MAX_BYTES)
    throw new InvalidMessageError('Message too large');
  let value: ServiceMessage;
  try {
    value = JSON.parse(content.toString('utf8')) as ServiceMessage;
  } catch {
    throw new InvalidMessageError('Invalid JSON');
  }
  const route =
    value && Object.prototype.hasOwnProperty.call(MESSAGE_ROUTES, value.type)
      ? MESSAGE_ROUTES[value.type]
      : undefined;
  const created = Date.parse(value?.createdAt);
  const expires = Date.parse(value?.expiresAt);
  if (
    !route ||
    value.version !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.id,
    ) ||
    value.source !== route[0] ||
    value.destination !== route[1] ||
    value.destination !== destination ||
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    expires <= created ||
    expires - created > MESSAGE_MAX_AGE_MS ||
    created > Date.now() + 60000 ||
    !value.payload ||
    typeof value.payload !== 'object' ||
    Array.isArray(value.payload)
  ) {
    throw new InvalidMessageError('Invalid message envelope');
  }
  return value;
}
