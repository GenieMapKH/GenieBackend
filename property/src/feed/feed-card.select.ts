/** Photos a feed card can swipe through; opening the listing reads them all. */
const CARD_PHOTOS = 5;

/**
 * What a feed card shows, and nothing more: no description, nearby places,
 * keywords or owner contact details. Opening a listing reads it in full
 * (`GET /public/properties/:id`).
 */
export const FEED_CARD_SELECT = {
  id: true,
  title: true,
  price: true,
  propertyType: true,
  listingType: true,
  takeover: {
    select: { sellerAmount: true, paymentAmount: true, paymentFrequency: true },
  },
  discountType: true,
  discountValue: true,
  status: true,
  createdAt: true,
  publishedAt: true,
  // A "price dropped" mark: when, and the price before.
  priceDroppedAt: true,
  previousPrice: true,
  lat: true,
  lng: true,
  bedrooms: true,
  bathrooms: true,
  landSize: true,
  buildingSize: true,
  unitSize: true,
  // A Borey's card size.
  totalProjectArea: true,
  images: {
    select: { url: true, thumbnailUrl: true },
    orderBy: { order: 'asc' },
    take: CARD_PHOTOS,
  },
  user: { select: { id: true, username: true, name: true, avatarUrl: true } },
} as const;
