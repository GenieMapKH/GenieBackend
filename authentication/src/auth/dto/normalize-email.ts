/** The longest address SMTP allows. */
export const EMAIL_MAX_LENGTH = 254;

/** `class-transformer` step for email fields: surrounding spaces and capitals never make a different account. */
export function normalizeEmailInput({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** As `normalizeEmailInput`, for an optional field: left blank means "no email". */
export function normalizeOptionalEmailInput({
  value,
}: {
  value: unknown;
}): unknown {
  const normalized = normalizeEmailInput({ value });
  return normalized === '' || normalized === null ? undefined : normalized;
}
