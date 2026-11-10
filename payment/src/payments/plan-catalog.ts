/** Server prices (USD, tax included); clients cannot set prices or limits. */
export const PLANS = {
  free: { amount: 0, listingLimit: 1 },
  silver: { amount: 5.9, listingLimit: 20 },
  gold: { amount: 8.9, listingLimit: 50 },
  diamond: { amount: 16.9, listingLimit: 120 },
} as const;
export type PaidTier = 'silver' | 'gold' | 'diamond';

/** One calendar month, preserving the UTC purchase time and clamping month end. */
export function monthAfter(start: Date): Date {
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return end;
}
