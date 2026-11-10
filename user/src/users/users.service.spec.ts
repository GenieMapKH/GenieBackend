import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

const ME = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';

/** What the global ValidationPipe does to a request body. */
async function parse(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, invalid: errors.map((error) => error.property) };
}

describe('UpdateProfileDto', () => {
  it('lowercases a username and accepts letters, digits, "_" and "."', async () => {
    const { dto, invalid } = await parse({ username: '  Sokha_99.kh ' });

    expect(invalid).toEqual([]);
    expect(dto.username).toBe('sokha_99.kh');
  });

  it.each(['ab', 'has space', 'សុខា', 'a'.repeat(31), '', null])(
    'refuses the username %p',
    async (username) => {
      expect((await parse({ username })).invalid).toEqual(['username']);
    },
  );

  it('lets any two people share a name, and clears a field sent empty', async () => {
    const { dto, invalid } = await parse({
      name: '  Sokha Chan ',
      firstName: '   ',
      lastName: null,
    });

    expect(invalid).toEqual([]);
    expect(dto).toMatchObject({
      name: 'Sokha Chan',
      firstName: null,
      lastName: null,
    });
  });

  it('accepts only the three known values for sex', async () => {
    expect((await parse({ sex: 'female' })).invalid).toEqual([]);
    expect((await parse({ sex: null })).invalid).toEqual([]);
    expect((await parse({ sex: 'unknown' })).invalid).toEqual(['sex']);
  });

  it('leaves out fields that were not sent, so they are not overwritten', async () => {
    const { dto } = await parse({ name: 'Sokha' });

    expect(Object.keys(dto)).toEqual(['name']);
  });
});

describe('UsersService', () => {
  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const properties = { notifyVisibilityChanged: jest.fn() };
  const cache = {
    delete: jest.fn(),
    remember: jest.fn(
      (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
    ),
  };
  let service: UsersService;

  const uniqueViolation = Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prisma as never,
      cache as never,
      properties as never,
    );
  });

  it('saves the changed fields and drops the cached public profile', async () => {
    prisma.user.update.mockResolvedValue({
      id: ME,
      username: 'sokha',
      name: 'Sokha',
    });

    const profile = await service.updateProfile(ME, {
      username: 'sokha',
      name: 'Sokha',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ME },
        data: { username: 'sokha', name: 'Sokha' },
      }),
    );
    expect(cache.delete).toHaveBeenCalledWith(`users:public-profile:${ME}`);
    expect(profile).toMatchObject({ username: 'sokha' });
  });

  it('shows a changed name or picture to other people at once, on listings too', async () => {
    prisma.user.update.mockResolvedValue({ id: ME, name: 'New Name' });

    await service.updateProfile(ME, { name: 'New Name' });

    // Published listings carry their owner's name and picture, and belong to the property service.
    expect(properties.notifyVisibilityChanged).toHaveBeenCalledWith(ME);
    expect(cache.delete).toHaveBeenCalledWith(`users:public-profile:${ME}`);
  });

  describe('checking a username while it is typed', () => {
    it('is available when nobody has it', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.checkUsername(ME, '  Sokha_99 ')).resolves.toEqual({
        username: 'sokha_99',
        available: true,
        reason: null,
      });
      // Compared the way it would be saved: lowercase, no surrounding spaces.
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'sokha_99' },
        select: { id: true },
      });
    });

    it('is taken when another account has it', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: SOMEONE_ELSE });

      await expect(service.checkUsername(ME, 'dara')).resolves.toMatchObject({
        available: false,
        reason: 'taken',
      });
    });

    it("is still available when it is the caller's own, so an unchanged field is not an error", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: ME });

      await expect(service.checkUsername(ME, 'sokha')).resolves.toMatchObject({
        available: true,
        reason: null,
      });
    });

    it.each(['ab', 'has space', 'សុខា', 'x'.repeat(31), ''])(
      'rejects %p without asking the database',
      async (input) => {
        await expect(service.checkUsername(ME, input)).resolves.toMatchObject({
          available: false,
          reason: 'invalid',
        });
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      },
    );
  });

  it('says the username is taken when someone else has it', async () => {
    prisma.user.update.mockRejectedValue(uniqueViolation);
    prisma.user.findUnique.mockResolvedValue({ id: SOMEONE_ELSE });

    await expect(
      service.updateProfile(ME, { username: 'sokha' }),
    ).rejects.toThrow(new ConflictException('Username is already taken'));
  });

  it('refuses recovery-phone changes through ordinary profile editing', async () => {
    prisma.user.update.mockRejectedValue(uniqueViolation);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.updateProfile(ME, { username: 'sokha', phone: '012345678' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  describe('what the profile says about signing in', () => {
    const row = {
      id: ME,
      hasPassword: false,
      firebaseUid: null as string | null,
      avatarUrl: null as string | null,
    };

    it('a Google account has no password until its owner creates one', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...row,
        firebaseUid: 'google-1',
      });
      expect(await service.getProfile(ME)).toMatchObject({
        hasPassword: false,
      });

      prisma.user.findUnique.mockResolvedValue({
        ...row,
        firebaseUid: 'google-1',
        hasPassword: true,
      });
      expect(await service.getProfile(ME)).toMatchObject({ hasPassword: true });
    });

    it('an account without Google always has one, whatever an old row says', async () => {
      prisma.user.findUnique.mockResolvedValue(row);

      expect(await service.getProfile(ME)).toMatchObject({ hasPassword: true });
    });

    it('says whether the picture is synced from Google', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...row,
        avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
      });
      expect(await service.getProfile(ME)).toMatchObject({
        avatarFromGoogle: true,
      });

      prisma.user.findUnique.mockResolvedValue({
        ...row,
        avatarUrl: 'https://storage.test/avatars/me/1',
      });
      expect(await service.getProfile(ME)).toMatchObject({
        avatarFromGoogle: false,
      });
    });
  });

  it('reads the public admin role without exposing credentials or contacts', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: SOMEONE_ELSE,
      role: 'admin',
    });
    expect(await service.getPublicProfile(SOMEONE_ELSE)).toMatchObject({
      role: 'admin',
    });
    const { select } = prisma.user.findFirst.mock.calls[0][0];
    expect(select.role).toBe(true);
    expect(select.passwordHash).toBeUndefined();
    expect(select.email).toBeUndefined();
    expect(select.phone).toBeUndefined();
  });

  it('hides a deactivated account from other people', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.getPublicProfile(SOMEONE_ELSE)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOMEONE_ELSE, deactivatedAt: null },
      }),
    );
  });
});
