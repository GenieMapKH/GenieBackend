/** The header the app sends its sign-in device key in, on `/auth/...` requests only. */
export const DEVICE_KEY_HEADER = 'x-device-key';

/** 32 random bytes as base64url is 43 characters; anything shorter is too easy to guess. */
const DEVICE_KEY = /^[A-Za-z0-9_-]{43,128}$/;

/** The device key the client sent, or null when it sent none or one too weak to trust. */
export function readDeviceKey(value: unknown): string | null {
  const raw: unknown = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && DEVICE_KEY.test(raw) ? raw : null;
}
