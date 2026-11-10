import { inLocale, texts } from '../delivery/notification-texts';
import { PushContent, PushTarget } from '../delivery/push-sender';

/** A listing that went live and a saved search it matches. */
export interface SavedSearchMatch {
  propertyId: string;
  /** The listing's title, as its owner wrote it. */
  title: string;
  searchName: string;
}

/** `New listing in "Toul Kork houses"`, the listing's title below. Opens the listing. */
export function savedSearchMatchPush(
  match: SavedSearchMatch,
  target: PushTarget,
): PushContent {
  return {
    alert: {
      title: inLocale(
        texts.newListingInSearch,
        target.locale,
      )(match.searchName),
      body: match.title,
    },
    data: { type: 'saved_search_match', propertyId: match.propertyId },
    channel: 'listing_alerts',
    // One notification per listing, however many searches it matched.
    tag: `listing:${match.propertyId}`,
    urgent: false,
  };
}
