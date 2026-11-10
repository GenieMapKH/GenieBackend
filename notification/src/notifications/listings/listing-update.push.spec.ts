import { PushTarget } from '../delivery/push-sender';
import {
  followedListingPush,
  priceDropPush,
  soldPush,
} from './listing-update.push';

const target = (locale: PushTarget['locale']): PushTarget => ({
  id: 'd1',
  token: 't',
  platform: 'android',
  locale,
});

describe('listing update pushes', () => {
  const listing = { propertyId: 'p1', title: 'Villa near Riverside' };

  it('names who posted a new listing', () => {
    expect(
      followedListingPush({ ...listing, ownerName: 'Dara' }, target('en')),
    ).toMatchObject({
      alert: {
        title: 'Dara posted a new listing',
        body: 'Villa near Riverside',
      },
      data: { type: 'followed_listing', propertyId: 'p1' },
      channel: 'listing_alerts',
      tag: 'listing:p1',
    });
  });

  it('shows a price drop as before and after, in dollars', () => {
    const push = priceDropPush(
      { ...listing, from: 120000, to: 110000 },
      target('km'),
    );
    expect(push.alert).toEqual({
      title: 'តម្លៃបានធ្លាក់ចុះ៖ Villa near Riverside',
      body: '$120,000 → $110,000',
    });
    expect(push.data).toEqual({ type: 'price_drop', propertyId: 'p1' });
  });

  it('says a saved listing was sold', () => {
    expect(soldPush(listing, target('en')).alert).toEqual({
      title: 'Sold: Villa near Riverside',
      body: 'A listing you saved is no longer available.',
    });
  });
});
