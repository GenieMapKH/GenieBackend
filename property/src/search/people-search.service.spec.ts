import { NotFoundException } from '@nestjs/common';
import { PeopleSearchService } from './people-search.service';

const row = {
  id: 'u-1',
  name: 'Sokha Realty',
  username: 'sokha_realty',
  avatarUrl: null,
  createdAt: new Date('2025-03-01T00:00:00Z'),
  email: 'sokha@example.com',
  phone: '+85512345678',
  _count: { properties: 2 },
};

describe('PeopleSearchService', () => {
  const users = { findMany: jest.fn(), findFirst: jest.fn() };
  const people = new PeopleSearchService({ user: users } as never);

  beforeEach(() => jest.clearAllMocks());

  it('never reads contact details for a list of results', async () => {
    users.findMany.mockResolvedValue([row]);

    const [found] = await people.matching(['sokha'], 5);

    const { select } = users.findMany.mock.calls[0][0];
    expect(select.email).toBeUndefined();
    expect(select.phone).toBeUndefined();
    expect(found).not.toHaveProperty('email');
    expect(found).not.toHaveProperty('phone');
  });

  it("includes email and phone on a publisher's own profile", async () => {
    users.findFirst.mockResolvedValue(row);

    expect(await people.findProfile('u-1')).toEqual({
      id: 'u-1',
      isAdmin: false,
      name: 'Sokha Realty',
      username: 'sokha_realty',
      avatarUrl: null,
      listingCount: 2,
      memberSince: row.createdAt,
      email: 'sokha@example.com',
      phone: '+85512345678',
    });
  });

  it('shows someone who has published nothing, without contact details', async () => {
    users.findFirst.mockResolvedValue({ ...row, _count: { properties: 0 } });

    const profile = await people.findProfile('u-1');

    expect(profile.listingCount).toBe(0);
    expect(profile.email).toBeNull();
    expect(profile.phone).toBeNull();
    expect(users.findFirst.mock.calls[0][0].where).toEqual({
      id: 'u-1',
      deactivatedAt: null,
    });
  });

  it('identifies administrators from the saved role', async () => {
    users.findFirst.mockResolvedValue({ ...row, role: 'admin' });
    expect(await people.findProfile('u-1')).toMatchObject({ isAdmin: true });
    expect(users.findFirst.mock.calls[0][0].select.role).toBe(true);
  });

  it('is 404 for a missing or deactivated account', async () => {
    users.findFirst.mockResolvedValue(null);

    await expect(people.findProfile('u-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
