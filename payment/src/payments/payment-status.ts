/** Lifecycle of a PaymentTransaction row. */
export const PaymentStatus = {
  Pending: 'Pending',
  Success: 'Success',
  Failed: 'Failed',
} as const;

/** USD, tax included; matches the displayed one-time publishing fee. */
export const PUBLISH_FEE = 1;
