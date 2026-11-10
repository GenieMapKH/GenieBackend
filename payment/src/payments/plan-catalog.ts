/** Server prices (USD, tax included); clients cannot set prices or limits. */
export const PLANS = {
  free: { amount: 0, listingLimit: 1 },
  silver: { amount: 7, listingLimit: 10 },
  gold: { amount: 15, listingLimit: 30 },
  diamond: { amount: 29, listingLimit: 100 },
} as const;
export type PaidTier = 'silver' | 'gold' | 'diamond';
export type BillingPeriod = 'monthly' | 'annual';

export function planPrice(tier: PaidTier, period: BillingPeriod): number {
  return PLANS[tier].amount * (period === 'annual' ? 10 : 1);
}

/** Paid listings run for exactly 30 days, independently of calendar months. */
export function listingExpiry(start: Date): Date {
  return new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
}

/** One calendar month, preserving the UTC purchase time and clamping month end. */
export function monthAfter(start: Date, months = 1): Date {
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return end;
}
