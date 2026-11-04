import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserRepository } from './user.repository';

/** What Prisma throws for a write that breaks a unique constraint. */
const UNIQUE_VIOLATION = Object.assign(new Error('Unique constraint failed'), {
  code: 'P2002',
});

const ROW = {
  id: 'u1',
  email: 'a@b.com',
  phone: null,
  passwordHash: 'hash',
  hasPassword: true,
  role: 'user',
  username: 'user_0123456789',
  name: null,
  avatarUrl: null,
  firebaseUid: null,
  deactivatedAt: null,
};

function fakePrisma() {
  return {
    user: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

describe('UserRepository.create', () => {
  const newUser = { email: 'a@b.com', password_hash: 'hash', role: 'user' };

  it('creates the account without a username: the database draws a random unused one', async () => {
    const prisma = fakePrisma();
    prisma.user.create.mockResolvedValueOnce(ROW);
    const repository = new UserRepository(prisma as never);

    await expect(repository.create(newUser)).resolves.toMatchObject({
      id: 'u1',
      password_hash: 'hash',
      username: 'user_0123456789',
    });

    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data).toEqual({
      email: 'a@b.com',
      passwordHash: 'hash',
      role: 'user',
    });
    expect(data).not.toHaveProperty('username');
  });

  it('draws another handle when the random one happens to be taken', async () => {
    const prisma = fakePrisma();
    prisma.user.create
      .mockRejectedValueOnce(UNIQUE_VIOLATION)
      .mockResolvedValueOnce({ ...ROW, username: 'user_9876543210' });
    const repository = new UserRepository(prisma as never);

    await expect(repository.create(newUser)).resolves.toMatchObject({
      username: 'user_9876543210',
    });
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { OR: [{ email: 'a@b.com' }] },
    });
  });

  it('still tells the user when it is the email or phone that is taken, without retrying', async () => {
    const prisma = fakePrisma();
    prisma.user.create.mockRejectedValueOnce(UNIQUE_VIOLATION);
    prisma.user.count.mockResolvedValueOnce(1);
    const repository = new UserRepository(prisma as never);

    await expect(repository.create(newUser)).rejects.toThrow(
      new ConflictException('Email or phone already exists'),
    );
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it('gives up with a server error, not a wrong "email in use", if handles keep colliding', async () => {
    const prisma = fakePrisma();
    prisma.user.create.mockRejectedValue(UNIQUE_VIOLATION);
    const repository = new UserRepository(prisma as never);

    await expect(repository.create(newUser)).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(prisma.user.create).toHaveBeenCalledTimes(5);
  });

  it('reports any other database failure as a server error', async () => {
    const prisma = fakePrisma();
    prisma.user.create.mockRejectedValueOnce(new Error('connection lost'));
    const repository = new UserRepository(prisma as never);

    await expect(repository.create(newUser)).rejects.toThrow(
      new InternalServerErrorException('Failed to create user'),
    );
  });
});

describe('UserRepository email handling', () => {
  it('looks an email up in lowercase, ignoring surrounding spaces', async () => {
    const prisma = fakePrisma();
    prisma.user.findFirst.mockResolvedValueOnce(ROW);
    const repository = new UserRepository(prisma as never);

    await expect(
      repository.findByEmail('  Foo@Gmail.COM '),
    ).resolves.toMatchObject({
      id: 'u1',
    });

    expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({
      email: 'foo@gmail.com',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('finds an older account that still has capitals by an exact, case-blind match', async () => {
    const prisma = fakePrisma();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'old' }]);
    prisma.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...ROW, id: 'old', email: 'A_B%c@x.com' });
    const repository = new UserRepository(prisma as never);

    await expect(repository.findByEmail('a_b%c@x.com')).resolves.toMatchObject({
      id: 'old',
    });

    const [sql, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(sql.join('?')).toContain('lower(email) = ?');
    expect(sql.join('?')).not.toMatch(/like/i);
    expect(values).toEqual(['a_b%c@x.com']);
    expect(prisma.user.findFirst.mock.calls[1][0].where).toEqual({ id: 'old' });
  });

  it("stores a new account's email in lowercase", async () => {
    const prisma = fakePrisma();
    prisma.user.create.mockResolvedValueOnce(ROW);
    const repository = new UserRepository(prisma as never);

    await repository.create({ email: ' Foo@Gmail.com ', password_hash: 'h' });

    expect(prisma.user.create.mock.calls[0][0].data).toEqual({
      email: 'foo@gmail.com',
      passwordHash: 'h',
    });
  });

  it('turns stored times into ISO strings', async () => {
    const prisma = fakePrisma();
    prisma.user.findFirst.mockResolvedValueOnce({
      ...ROW,
      deactivatedAt: new Date('2026-11-04T10:00:00.000Z'),
    });
    const repository = new UserRepository(prisma as never);

    await expect(repository.findById('u1')).resolves.toMatchObject({
      deactivated_at: '2026-11-04T10:00:00.000Z',
    });
  });
});
