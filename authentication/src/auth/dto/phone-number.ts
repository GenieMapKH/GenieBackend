import { E164_PHONE_NUMBER, normalizePhoneNumber } from '@tilomnov/shared';

/** Checked after `normalizePhoneInput`, which leaves a number it cannot read as typed. */
export const PHONE_NUMBER = E164_PHONE_NUMBER;

export const PHONE_NUMBER_MESSAGE =
  'Enter a valid phone number, for example 012 345 678';

/** `class-transformer` step for phone fields: one stored spelling per number (see `normalizePhoneNumber`). */
export function normalizePhoneInput({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  return normalizePhoneNumber(value) ?? value;
}
