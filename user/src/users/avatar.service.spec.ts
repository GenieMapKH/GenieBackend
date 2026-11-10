import { BadRequestException } from '@nestjs/common';
import { AvatarService } from './avatar.service';

const ME = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';
const PUBLIC = 'https://storage.test/public/avatars';

describe('AvatarService', () => {
  const userTable = { findUnique: jest.fn(), update: jest.fn() };
  const storage = {
    ensureBucket: jest.fn(),
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn(),
    publicUrl: jest.fn((_bucket: string, path: string) => `${PUBLIC}/${path}`),
    removeFiles: jest.fn(),
    removeFolder: jest.fn(),
  };
  const users = { publicViewChanged: jest.fn(), getProfile: jest.fn() };
  let avatars: AvatarService;

  beforeEach(() => {
    jest.clearAllMocks();
    userTable.findUnique.mockResolvedValue({ avatarUrl: null });
    storage.createSignedUploadUrl.mockResolvedValue(
      'https://storage.test/upload?token=t',
    );
    storage.createSignedDownloadUrl.mockResolvedValue(
      'https://storage.test/signed',
    );
    users.getProfile.mockResolvedValue({ id: ME });
    avatars = new AvatarService(
      { user: userTable } as never,
      storage as never,
      users as never,
    );
  });

  it("hands out an upload location inside the user's own folder", async () => {
    const upload = await avatars.createUpload(ME);

    expect(upload.path).toMatch(new RegExp(`^${ME}/[0-9a-f-]{36}$`));
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(
      'avatars',
      upload.path,
    );
  });

  it('uses an uploaded picture, and tells everyone who shows the user', async () => {
    await avatars.useUpload(ME, `${ME}/${FILE}`);

    expect(userTable.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { avatarUrl: `${PUBLIC}/${ME}/${FILE}` },
    });
    expect(users.publicViewChanged).toHaveBeenCalledWith(ME);
  });

  it.each([
    ["a picture in someone else's folder", `${SOMEONE_ELSE}/${FILE}`],
    [
      'a path that climbs out of the folder',
      `${ME}/../${SOMEONE_ELSE}/${FILE}`,
    ],
    ['a URL', 'https://evil.example/a.png'],
  ])('refuses %s', async (_case, path) => {
    await expect(avatars.useUpload(ME, path)).rejects.toThrow(
      BadRequestException,
    );
    expect(userTable.update).not.toHaveBeenCalled();
  });

  it('refuses a picture that was never uploaded', async () => {
    storage.createSignedDownloadUrl.mockResolvedValue(null);

    await expect(avatars.useUpload(ME, `${ME}/${FILE}`)).rejects.toThrow(
      'not uploaded',
    );
  });

  it('deletes the picture it replaces, which nobody can see any more', async () => {
    userTable.findUnique.mockResolvedValue({
      avatarUrl: `${PUBLIC}/${ME}/old-picture`,
    });

    await avatars.useGooglePhoto(
      ME,
      'https://lh3.googleusercontent.com/a/photo',
    );

    expect(storage.removeFiles).toHaveBeenCalledWith('avatars', [
      `${ME}/old-picture`,
    ]);
  });

  it('leaves a Google photo alone when it is replaced: it is not ours to delete', async () => {
    userTable.findUnique.mockResolvedValue({
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
    });

    await avatars.remove(ME);

    expect(userTable.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { avatarUrl: null },
    });
    expect(storage.removeFiles).not.toHaveBeenCalled();
  });

  it('syncs only with a real Google photo', async () => {
    await expect(
      avatars.useGooglePhoto(ME, 'https://evil.example/tracker.png'),
    ).rejects.toThrow(BadRequestException);
    expect(userTable.update).not.toHaveBeenCalled();
  });

  it('still changes the picture when the old file cannot be deleted', async () => {
    userTable.findUnique.mockResolvedValue({
      avatarUrl: `${PUBLIC}/${ME}/old-picture`,
    });
    storage.removeFiles.mockRejectedValue(new Error('storage down'));

    await expect(avatars.remove(ME)).resolves.toEqual({ id: ME });
  });
});
