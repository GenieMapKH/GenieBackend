/**
 * How every phone number is stored: E.164, "+" then 8 to 15 digits
 * (`+85512345678`). One spelling per number, so `012 345 678` and
 * `+855 12 345 678` are the same account.
 */
export const E164_PHONE_NUMBER = /^\+[1-9][0-9]{7,14}$/;

const CAMBODIA_CODE = '855';

/** A Cambodian number without its leading 0: 8 or 9 digits. */
const CAMBODIA_NATIONAL = /^[1-9][0-9]{7,8}$/;

/** What people type between digits: spaces, dashes, dots, brackets. */
const SEPARATORS = /[\s().-]/g;

/**
 * The E.164 form of a typed phone number, or null when it is not one.
 * Numbers without a country code are Cambodian: `012 345 678`, `12345678`,
 * `855 12 345 678`, `+855 012 345 678` and `00855 12 345 678` all give
 * `+85512345678`. Other countries need their "+" or "00" prefix.
 */
export function normalizePhoneNumber(input: string): string | null {
  let digits = input.replace(SEPARATORS, '');
  let international = false;
  if (digits.startsWith('+')) {
    international = true;
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    international = true;
    digits = digits.slice(2);
  }
  if (!/^[0-9]+$/.test(digits)) return null;

  if (international && !digits.startsWith(CAMBODIA_CODE)) {
    const e164 = `+${digits}`;
    return E164_PHONE_NUMBER.test(e164) ? e164 : null;
  }
  return cambodianNumber(digits, international);
}

function cambodianNumber(digits: string, hasCode: boolean): string | null {
  let national = digits;
  if (hasCode || (digits.startsWith(CAMBODIA_CODE) && digits.length >= 11)) {
    national = digits.slice(CAMBODIA_CODE.length);
  }
  // "+855 0..." is common: the trunk 0 is never part of the number.
  if (national.startsWith('0')) national = national.slice(1);
  return CAMBODIA_NATIONAL.test(national)
    ? `+${CAMBODIA_CODE}${national}`
    : null;
}

/**
 * The spellings an E.164 number may have been stored in before numbers were
 * normalized (the app used to send what was typed, without separators).
 * Lookups try them all so older accounts still sign in.
 */
export function phoneNumberVariants(e164: string): string[] {
  const variants = [e164, e164.slice(1)];
  if (e164.startsWith(`+${CAMBODIA_CODE}`)) {
    variants.push(`0${e164.slice(CAMBODIA_CODE.length + 1)}`);
  }
  return variants;
}
