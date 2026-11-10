/** A price and its discount, as a listing stores them. */
export interface PricedListing {
  price: number;
  discountType?: string | null;
  discountValue?: number | null;
}

/** Smaller cuts are not news: a buyer is not told about a dollar off. */
const MIN_DROP_SHARE = 0.01;

/** What a buyer pays: the asking price less any discount (USD). */
export function buyerPrice(listing: PricedListing): number {
  const { price, discountType, discountValue } = listing;
  if (discountValue == null || discountValue <= 0) return price;
  if (discountType === 'percent') return price * (1 - discountValue / 100);
  if (discountType === 'amount') return Math.max(0, price - discountValue);
  return price;
}

/**
 * How the price a buyer pays fell between [before] and [after], or null
 * when it did not fall by at least 1%. Rounded to the cent, as stored.
 */
export function priceDrop(
  before: PricedListing,
  after: PricedListing,
): { from: number; to: number } | null {
  const from = toCents(buyerPrice(before));
  const to = toCents(buyerPrice(after));
  if (from <= 0 || to >= from * (1 - MIN_DROP_SHARE)) return null;
  return { from, to };
}

const toCents = (value: number) => Math.round(value * 100) / 100;

export type StoredPrice = {
  price: { toString(): string };
  discountType: string | null;
  discountValue: { toString(): string } | null;
};

/** A stored listing's price and discount as numbers. */
export const pricedOf = (listing: StoredPrice): PricedListing => ({
  price: Number(listing.price),
  discountType: listing.discountType,
  discountValue:
    listing.discountValue == null ? null : Number(listing.discountValue),
});

/**
 * What an edit writes about price drops: a drop dates it and keeps the
 * price before it (the "price dropped" mark); a later price at or above that
 * one takes the mark away.
 */
export function priceDropColumns(
  before: { previousPrice: { toString(): string } | null },
  after: PricedListing,
  drop: { from: number } | null,
) {
  if (drop) return { priceDroppedAt: new Date(), previousPrice: drop.from };
  const previous =
    before.previousPrice == null ? null : Number(before.previousPrice);
  if (previous !== null && buyerPrice(after) >= previous) {
    return { priceDroppedAt: null, previousPrice: null };
  }
  return {};
}
