import { PropertyStatusService } from '../property-status.service';
import { PROPERTY_WITH_RELATIONS } from '../property-includes';
import { PropertyLifecycleService } from './property-lifecycle.service';

describe('property posting and archive transitions', () => {
  const firstPublished = new Date('2026-11-01T00:00:00Z');
  const listing = {
    id: 'p1',
    userId: 'u1',
    title: 'Land',
    price: 100,
    propertyType: 'Land',
    status: 'Active',
    lat: null,
    publishedAt: firstPublished,
    contactPhone: '+85512345678',
  };
  const property = { create: jest.fn(), update: jest.fn() };
  const prisma = {
    property,
    user: { findUnique: jest.fn() },
  };
  const query = { findOwned: jest.fn() };
  const changes = { changed: jest.fn() };
  const allowance = {
    publish: jest.fn((_user, write) => write(prisma)),
  };
  const service = new PropertyLifecycleService(
    prisma as never,
    query as never,
    new PropertyStatusService(),
    changes as never,
    {} as never,
    {} as never,
    allowance as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ phone: '+85512345678' });
    query.findOwned.mockResolvedValue(listing);
    property.create.mockImplementation(async ({ data }) => ({
      ...listing,
      ...data,
    }));
    property.update.mockImplementation(async ({ data }) => ({
      ...listing,
      ...data,
    }));
  });

  it('posts publicly only through the publishing allowance and uses the permitted owner projection', async () => {
    await expect(
      service.create('u1', {
        title: 'Land',
        price: 100,
        propertyType: 'Land',
        status: 'Active',
      }),
    ).resolves.toMatchObject({
      status: 'Active',
      contactPhone: '+85512345678',
    });
    expect(allowance.publish).toHaveBeenCalledWith('u1', expect.any(Function));
    expect(property.create).toHaveBeenCalledWith(
      expect.objectContaining({ include: PROPERTY_WITH_RELATIONS }),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { phone: true },
    });
  });

  it('archives a public property without requiring subscription capacity', async () => {
    await expect(service.unpublish('u1', 'p1')).resolves.toMatchObject({
      status: 'Draft',
    });
    expect(query.findOwned).toHaveBeenCalledWith('u1', 'p1');
    expect(property.update).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'Active' },
      data: { status: 'Draft' },
    });
    expect(allowance.publish).not.toHaveBeenCalled();
    expect(changes.changed).toHaveBeenCalled();
  });

  it('republishes an archived property through allowance without bumping its original date', async () => {
    query.findOwned.mockResolvedValue({ ...listing, status: 'Draft' });
    await expect(service.publish('u1', 'p1')).resolves.toMatchObject({
      status: 'Active',
      publishedAt: firstPublished,
    });
    expect(allowance.publish).toHaveBeenCalledWith(
      'u1',
      expect.any(Function),
      'p1',
    );
    expect(property.update).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'Draft' },
      data: {
        status: 'Active',
        contactPhone: '+85512345678',
        publishedAt: firstPublished,
      },
    });
  });

  it('does not archive a property while payment is pending', async () => {
    query.findOwned.mockResolvedValue({ ...listing, status: 'Pending' });
    await expect(service.unpublish('u1', 'p1')).rejects.toMatchObject({
      status: 400,
    });
    expect(property.update).not.toHaveBeenCalled();
  });

  it('does not write when the owner lookup fails with a database permission error', async () => {
    query.findOwned.mockRejectedValueOnce(
      new Error('permission denied for table users'),
    );
    await expect(service.publish('u1', 'p1')).rejects.toThrow(
      'permission denied for table users',
    );
    expect(property.update).not.toHaveBeenCalled();
    expect(allowance.publish).not.toHaveBeenCalled();
  });
});
