import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * bcrypt only reads the first 72 bytes of a password. A longer one would let
 * a different tail log in as the same password, so it is refused when set.
 */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/** The text is at most `max` bytes in UTF-8 (letters outside A-Z take 2 to 4). */
export function MaxBytes(max: number, options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'maxBytes',
      constraints: [max],
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
        defaultMessage: () =>
          `Password is too long (at most ${max} bytes, about ${max} letters or digits)`,
      },
    },
    options,
  );
}
