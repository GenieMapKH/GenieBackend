import { NotFoundException } from '@nestjs/common';
import { AdminPropertiesService } from './admin-properties.service';
describe('admin property moderation', () => {
  const prisma = {
    property: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  };
  const lifecycle = { update: jest.fn() };
  const changes = { changed: jest.fn() };
  const counts = { of: jest.fn() };
  const service = new AdminPropertiesService(
    prisma as never,
    lifecycle as never,
    changes as never,
    counts as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    counts.of.mockResolvedValue(new Map());
  });
  it('edits through the existing lifecycle and preserves ownership', async () => {
    prisma.property.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'owner',
      status: 'Active',
    });
    await service.update('p1', { title: 'Corrected title' });
    expect(lifecycle.update).toHaveBeenCalledWith('owner', 'p1', {
      title: 'Corrected title',
    });
  });
  it('removes even a pending post without deleting financial or report rows', async () => {
    prisma.property.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'owner',
      status: 'Pending',
    });
    await service.remove('p1');
    expect(prisma.property.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'Deleted' },
    });
    expect(changes.changed).toHaveBeenCalled();
    expect(await service.remove('p1')).toEqual({ id: 'p1', status: 'Deleted' });
  });
  it('rejects unknown properties', async () => {
    prisma.property.findUnique.mockResolvedValue(null);
    await expect(service.detail('missing')).rejects.toThrow(NotFoundException);
  });
  it('returns a bounded card projection with the fields the property detail route needs', async () => {
    prisma.property.findMany.mockResolvedValue([]);
    await service.batch(['p1']);
    expect(prisma.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          title: true,
          price: true,
          status: true,
          propertyType: true,
          createdAt: true,
          images: { orderBy: { order: 'asc' }, take: 1 },
        }),
      }),
    );
  });
});
