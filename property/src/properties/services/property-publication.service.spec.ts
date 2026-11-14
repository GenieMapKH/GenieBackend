import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PropertyStatusService } from '../property-status.service';
import { PropertyPublicationService } from './property-publication.service';

const ME = '11111111-1111-4111-8111-111111111111';
const LISTING = '33333333-3333-4333-8333-333333333333';
/** Whose the listing is and where: what the cache needs to drop its copies. */
const PLACE = { id: LISTING, userId: ME, lat: 11.56, lng: 104.92 };

describe('PropertyPublicationService', () => {
  const propertyTable = {
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const query = { findOwned: jest.fn() };
  const listingChanges = {
    changed: jest.fn(),
    wentLive: jest.fn().mockResolvedValue(undefined),
  };
  let service: PropertyPublicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    query.findOwned.mockResolvedValue({ id: LISTING, status: 'Draft' });
    propertyTable.updateMany.mockResolvedValue({ count: 1 });
    propertyTable.findUnique.mockResolvedValue(PLACE);
    service = new PropertyPublicationService(
      {
        property: propertyTable,
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ phone: '+85512345678', phoneVerified: true }),
        },
      } as never,
      query as never,
      new PropertyStatusService(),
      listingChanges as never,
      {
        payToPublish: (
          _user: string,
          _id: string,
          write: (tx: unknown) => unknown,
        ) => write({ property: propertyTable }),
      } as never,
    );
  });

  describe('beginPublish', () => {
    it('refuses payment to publish an incomplete takeover', async () => {
      query.findOwned.mockResolvedValue({
        id: LISTING,
        status: 'Draft',
        listingType: 'Takeover Payments',
        takeover: null,
      });
      await expect(service.beginPublish(ME, LISTING)).rejects.toThrow(
        BadRequestException,
      );
      expect(propertyTable.updateMany).not.toHaveBeenCalled();
    });
    it('parks the listing as Pending and says what it was', async () => {
      const result = await service.beginPublish(ME, LISTING);

      expect(query.findOwned).toHaveBeenCalledWith(ME, LISTING);
      expect(propertyTable.updateMany).toHaveBeenCalledWith({
        where: { id: LISTING, userId: ME, status: 'Draft' },
        data: { contactPhone: '+85512345678', status: 'Pending' },
      });
      expect(result).toEqual({ previousStatus: 'Draft' });
    });

    it('lets an expired listing be published again, to be dated anew once paid', async () => {
      query.findOwned.mockResolvedValue({ id: LISTING, status: 'Expired' });

      await expect(service.beginPublish(ME, LISTING)).resolves.toEqual({
        previousStatus: 'Expired',
      });
      expect(propertyTable.updateMany).toHaveBeenCalledWith({
        where: { id: LISTING, userId: ME, status: 'Expired' },
        data: {
          contactPhone: '+85512345678',
          status: 'Pending',
          publishedAt: null,
        },
      });
    });

    it.each(['Active', 'Pending', 'Sold'])(
      'refuses a listing that is %s',
      async (status) => {
        query.findOwned.mockResolvedValue({ id: LISTING, status });

        await expect(service.beginPublish(ME, LISTING)).rejects.toThrow(
          BadRequestException,
        );
        expect(propertyTable.update).not.toHaveBeenCalled();
      },
    );

    it("refuses someone else's listing", async () => {
      query.findOwned.mockRejectedValue(
        new NotFoundException('Property not found'),
      );

      await expect(service.beginPublish(ME, LISTING)).rejects.toThrow(
        NotFoundException,
      );
      expect(propertyTable.update).not.toHaveBeenCalled();
    });
  });

  describe('settlePublish', () => {
    it('checks the terms again before a paid takeover goes live', async () => {
      propertyTable.findUnique.mockResolvedValue({
        ...PLACE,
        status: 'Pending',
        listingType: 'Takeover Payments',
        takeover: null,
      });
      await expect(service.settlePublish(LISTING, 'Active')).rejects.toThrow(
        BadRequestException,
      );
      expect(propertyTable.updateMany).not.toHaveBeenCalled();
    });

    it('ignores a repeated settlement after an owner has unpublished and edited a takeover', async () => {
      propertyTable.findUnique.mockResolvedValue({
        ...PLACE,
        status: 'Draft',
        listingType: 'Takeover Payments',
        takeover: null,
      });
      propertyTable.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.settlePublish(LISTING, 'Active'),
      ).resolves.toBeUndefined();
      expect(listingChanges.changed).not.toHaveBeenCalled();
    });
    it('publishes a Pending listing never live before, dated now, and refreshes what visitors see', async () => {
      await service.settlePublish(LISTING, 'Active');

      expect(propertyTable.updateMany).toHaveBeenCalledTimes(1);
      expect(propertyTable.updateMany).toHaveBeenCalledWith({
        where: { id: LISTING, status: 'Pending', publishedAt: null },
        data: { status: 'Active', publishedAt: expect.any(Date) },
      });
      expect(listingChanges.changed).toHaveBeenCalledWith(PLACE);
    });

    it('keeps the first date of a draft that was live before and is paid for again', async () => {
      propertyTable.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await service.settlePublish(LISTING, 'Active');

      expect(propertyTable.updateMany).toHaveBeenLastCalledWith({
        where: { id: LISTING, status: 'Pending' },
        data: { status: 'Active' },
      });
      expect(listingChanges.changed).toHaveBeenCalledWith(PLACE);
    });

    it('returns an unpaid listing to Draft without touching the public cache', async () => {
      await service.settlePublish(LISTING, 'Draft');

      expect(propertyTable.updateMany).toHaveBeenCalledWith({
        where: { id: LISTING, status: 'Pending' },
        data: { status: 'Draft' },
      });
      expect(listingChanges.changed).not.toHaveBeenCalled();
    });

    it('changes only a Pending listing, so a repeated call does nothing', async () => {
      propertyTable.updateMany.mockResolvedValue({ count: 0 });

      await service.settlePublish(LISTING, 'Active');

      expect(listingChanges.changed).not.toHaveBeenCalled();
    });
  });

  it('puts a Pending listing back to the status it had', async () => {
    await service.revertPublish(LISTING, 'Expired');

    expect(propertyTable.updateMany).toHaveBeenCalledWith({
      where: { id: LISTING, status: 'Pending' },
      data: { status: 'Expired' },
    });
  });
});
