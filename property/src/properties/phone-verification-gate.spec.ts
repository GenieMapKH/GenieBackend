import { PropertyLifecycleService } from './services/property-lifecycle.service';
import { PropertyPublicationService } from './services/property-publication.service';
import { PropertyStatusService } from './property-status.service';

describe('server-side listing contact validation', () => {
  it.each([
    'create',
    'publish',
    'relist',
    'update',
    'beginPublish',
    'settlePublish',
  ])(
    'blocks %s before any listing write or publishing allowance is consumed',
    async (action) => {
      const listing = {
        id: 'p1',
        userId: 'u1',
        contactPhone: 'invalid',
        status:
          action === 'relist'
            ? 'Sold'
            : action === 'update'
              ? 'Active'
              : 'Draft',
      };
      const property = {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...listing, status: 'Pending' }),
      };
      const prisma = {
        property,
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ phone: 'invalid', phoneVerified: false }),
        },
      };
      const query = { findOwned: jest.fn().mockResolvedValue(listing) };
      const allowance = { publish: jest.fn(), payToPublish: jest.fn() };
      const lifecycle = new PropertyLifecycleService(
        prisma as never,
        query as never,
        new PropertyStatusService(),
        {} as never,
        {} as never,
        {} as never,
        allowance as never,
      );
      const publication = new PropertyPublicationService(
        prisma as never,
        query as never,
        new PropertyStatusService(),
        {} as never,
        allowance as never,
      );
      const run = () => {
        switch (action) {
          case 'create':
            return lifecycle.create('u1', {
              title: 'Test listing',
              price: 100,
              propertyType: 'Land',
              status: 'Active',
              contactPhone: 'invalid',
            });
          case 'publish':
            return lifecycle.publish('u1', 'p1');
          case 'relist':
            return lifecycle.relist('u1', 'p1');
          case 'update':
            return lifecycle.update('u1', 'p1', {
              contactPhone: 'invalid',
            });
          case 'beginPublish':
            return publication.beginPublish('u1', 'p1');
          default:
            return publication.settlePublish('p1', 'Active');
        }
      };
      await expect(run()).rejects.toMatchObject({
        status: 400,
      });
      expect(property.create).not.toHaveBeenCalled();
      expect(property.update).not.toHaveBeenCalled();
      expect(property.updateMany).not.toHaveBeenCalled();
      expect(allowance.publish).not.toHaveBeenCalled();
      expect(allowance.payToPublish).not.toHaveBeenCalled();
    },
  );
});
