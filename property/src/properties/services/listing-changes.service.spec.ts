import { ListingChanges } from './listing-changes.service';

const LISTING = { id: 'p-1', userId: 'u-1', lat: 11.5, lng: 104.9 };

describe('ListingChanges', () => {
  let publicCache: { changed: jest.Mock };
  let changes: ListingChanges;

  beforeEach(() => {
    publicCache = { changed: jest.fn().mockResolvedValue(undefined) };
    changes = new ListingChanges(publicCache as never);
  });

  it('outdates the public copies, naming where a moved listing was', async () => {
    const before = { lat: 10, lng: 104 };

    await changes.changed(LISTING, before);

    expect(publicCache.changed).toHaveBeenCalledWith(LISTING, before);
  });

  it('tells every listener', async () => {
    const first = { listingChanged: jest.fn().mockResolvedValue(undefined) };
    const second = { listingChanged: jest.fn().mockResolvedValue(undefined) };
    changes.listen(first);
    changes.listen(second);

    await changes.changed(LISTING);

    expect(first.listingChanged).toHaveBeenCalledWith(LISTING);
    expect(second.listingChanged).toHaveBeenCalledWith(LISTING);
  });

  it('never fails the change when a listener does', async () => {
    const other = { listingChanged: jest.fn().mockResolvedValue(undefined) };
    changes.listen({
      listingChanged: jest.fn().mockRejectedValue(new Error('search is down')),
    });
    changes.listen(other);

    await expect(changes.changed(LISTING)).resolves.toBeUndefined();
    expect(other.listingChanged).toHaveBeenCalled();
  });

  describe('wentLive', () => {
    it('tells every live listener, and a failing one does not stop the rest', async () => {
      const seen: string[] = [];
      changes.listenToEvents({
        listingWentLive: () => Promise.reject(new Error('down')),
      });
      changes.listenToEvents({
        listingWentLive: (id) => {
          seen.push(id);
          return Promise.resolve();
        },
      });

      await expect(changes.wentLive('p1')).resolves.toBeUndefined();
      expect(seen).toEqual(['p1']);
    });

    it('skips listeners that do not take an event', async () => {
      changes.listenToEvents({});
      const sold = jest.fn().mockResolvedValue(undefined);
      changes.listenToEvents({ listingSold: sold });

      await changes.priceDropped('p1', { from: 10, to: 9 });
      await changes.sold('p1');

      expect(sold).toHaveBeenCalledWith('p1');
    });
  });
});
