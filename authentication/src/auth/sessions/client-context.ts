import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** What is known about the device making a request. Shown under "Logged-in devices". */
export interface ClientContext {
  /** e.g. "Samsung SM-G991B". Sent by the app in `X-Device-Name`, URL-encoded. */
  deviceName: string | null;
  /** e.g. "Android 14". Sent by the app in `X-Device-Platform`, URL-encoded. */
  platform: string | null;
  /** Written to `X-Client-IP` by the api-gateway, which overwrites anything a client sent. */
  ipAddress: string | null;
}

const MAX_LENGTH = 100;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** These values are typed by the client: keep a short piece of printable text, or nothing. */
function readHeader(value: unknown): string | null {
  const raw: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;

  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // Not URL-encoded after all: use it as it came.
  }
  return (
    text.replace(CONTROL_CHARACTERS, '').trim().slice(0, MAX_LENGTH) || null
  );
}

export function clientContextFrom(
  headers: Record<string, unknown>,
): ClientContext {
  return {
    deviceName: readHeader(headers['x-device-name']),
    platform: readHeader(headers['x-device-platform']),
    ipAddress: readHeader(headers['x-client-ip']),
  };
}

/** Injects the [ClientContext] of the current request. */
export const Client = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientContext =>
    clientContextFrom(
      context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
        .headers,
    ),
);
