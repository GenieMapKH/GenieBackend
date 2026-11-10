import { inLocale, texts } from '../delivery/notification-texts';
import { PushContent, PushTarget } from '../delivery/push-sender';

/** `$ 120,000`: how prices read in a push. */
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** A push that opens [propertyId], one per listing on the phone. */
function aboutListing(
  type: string,
  propertyId: string,
  title: string,
  body: string,
): PushContent {
  return {
    alert: { title, body },
    data: { type, propertyId },
    channel: 'listing_alerts',
    tag: `listing:${propertyId}`,
    urgent: false,
  };
}

/** "Dara posted a new listing", its title below. */
export function followedListingPush(
  listing: { propertyId: string; title: string; ownerName: string },
  target: PushTarget,
): PushContent {
  return aboutListing(
    'followed_listing',
    listing.propertyId,
    inLocale(texts.newListingFrom, target.locale)(listing.ownerName),
    listing.title,
  );
}

/** "Price dropped: Villa near Riverside", "$ 120,000 → $ 110,000" below. */
export function priceDropPush(
  listing: { propertyId: string; title: string; from: number; to: number },
  target: PushTarget,
): PushContent {
  return aboutListing(
    'price_drop',
    listing.propertyId,
    inLocale(texts.priceDropped, target.locale)(listing.title),
    `${usd.format(listing.from)} → ${usd.format(listing.to)}`,
  );
}

/** "Sold: Villa near Riverside", and that it is no longer available. */
export function soldPush(
  listing: { propertyId: string; title: string },
  target: PushTarget,
): PushContent {
  return aboutListing(
    'listing_sold',
    listing.propertyId,
    inLocale(texts.sold, target.locale)(listing.title),
    inLocale(texts.savedListingSold, target.locale),
  );
}
