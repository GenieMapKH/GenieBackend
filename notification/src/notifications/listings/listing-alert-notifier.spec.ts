import { PushTarget } from '../delivery/push-sender';
import { ListingAlertNotifier } from './listing-alert-notifier';
import { savedSearchMatchPush } from './saved-search-match.push';

const device = (
  id: string,
  locale: PushTarget['locale'] = 'en',
): PushTarget => ({
  id,
  token: `token-${id}`,
  platform: 'android',
  locale,
});

describe('ListingAlertNotifier', () => {
  const devices = { targetsByUser: jest.fn() };
  const delivery = { deliver: jest.fn() };
  const notifier = new ListingAlertNotifier(
    devices as never,
    delivery as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    delivery.deliver.mockResolvedValue({ sent: 3, failed: 0, removed: 0 });
  });

  it("pushes each person's own text to every one of their devices, in one delivery", async () => {
    devices.targetsByUser.mockResolvedValue(
      new Map([
        ['alice', [device('a1'), device('a2', 'km')]],
        ['bob', [device('b1')]],
      ]),
    );
    const push = (searchName: string) => (target: PushTarget) =>
      savedSearchMatchPush(
        { propertyId: 'p1', title: 'Villa', searchName },
        target,
      );

    await notifier.notify('Saved search', 'savedSearchAlerts', [
      { userId: 'alice', push: push('Toul Kork') },
      { userId: 'bob', push: push('BKK1') },
      { userId: 'nobody', push: push('none') },
    ]);

    expect(devices.targetsByUser).toHaveBeenCalledWith(
      ['alice', 'bob', 'nobody'],
      'savedSearchAlerts',
    );
    const [targets, contentFor] = delivery.deliver.mock.calls[0] as [
      PushTarget[],
      (target: PushTarget) => { alert: { title: string } },
    ];
    expect(targets.map((t) => t.id)).toEqual(['a1', 'a2', 'b1']);
    expect(contentFor(targets[0]).alert.title).toBe(
      'New listing in "Toul Kork"',
    );
    expect(contentFor(targets[1]).alert.title).toBe(
      'អចលនទ្រព្យថ្មីក្នុង "Toul Kork"',
    );
    expect(contentFor(targets[2]).alert.title).toBe('New listing in "BKK1"');
  });

  it('a saved-search push opens the listing and replaces one about the same listing', () => {
    expect(
      savedSearchMatchPush(
        { propertyId: 'p1', title: 'Villa', searchName: 'x' },
        device('a1'),
      ),
    ).toMatchObject({
      data: { type: 'saved_search_match', propertyId: 'p1' },
      channel: 'listing_alerts',
      tag: 'listing:p1',
      urgent: false,
    });
  });
});
