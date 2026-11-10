import { SupabaseService } from './supabase.service';

const ME = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';

describe('SupabaseService.removeFolder', () => {
  /** A bucket as a map of path -> file, listed and deleted the way Supabase storage does it. */
  function serviceOver(paths: string[]) {
    const files = new Set(paths);
    const bucket = {
      list: async (folder: string) => {
        const names = new Map<string, { name: string; id: string | null }>();
        for (const path of files) {
          if (!path.startsWith(`${folder}/`)) continue;
          const [name, ...deeper] = path.slice(folder.length + 1).split('/');
          names.set(name, {
            name,
            id: deeper.length === 0 ? `id-${name}` : null,
          });
        }
        return { data: [...names.values()], error: null };
      },
      remove: async (targets: string[]) => {
        targets.forEach((path) => files.delete(path));
        return { error: null };
      },
    };
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const service = new SupabaseService();
    (service as unknown as { supabase: unknown }).supabase = {
      storage: { from: () => bucket },
    };
    return { service, files };
  }

  it('deletes every file under the folder, at any depth, and nothing else', async () => {
    const { service, files } = serviceOver([
      `${ME}/${SOMEONE_ELSE}/file-1`,
      `${ME}/${SOMEONE_ELSE}/file-2`,
      `${ME}/third-person/file-3`,
      `${SOMEONE_ELSE}/${ME}/file-4`,
      `${SOMEONE_ELSE}/third-person/file-5`,
    ]);

    await service.removeFolder('chat-attachments', ME);
    await service.removeFolder('chat-attachments', `${SOMEONE_ELSE}/${ME}`);

    expect([...files]).toEqual([`${SOMEONE_ELSE}/third-person/file-5`]);
  });

  it('does nothing for a folder that does not exist', async () => {
    const { service, files } = serviceOver([`${SOMEONE_ELSE}/file`]);

    await expect(service.removeFolder('avatars', ME)).resolves.toBeUndefined();
    expect(files.size).toBe(1);
  });
});

describe('SupabaseService.ensureBucket', () => {
  function serviceWith(existing: string[]) {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const storage = {
      listBuckets: jest.fn().mockResolvedValue({
        data: existing.map((name) => ({ name })),
        error: null,
      }),
      createBucket: jest.fn().mockResolvedValue({ error: null }),
      updateBucket: jest.fn().mockResolvedValue({ error: null }),
    };
    const service = new SupabaseService();
    (service as unknown as { supabase: unknown }).supabase = { storage };
    return { service, storage };
  }

  const limits = { public: false, fileSizeLimit: 2 * 1024 * 1024 };

  it('creates a missing bucket with its size limit', async () => {
    const { service, storage } = serviceWith([]);

    await service.ensureBucket('avatars', limits);

    expect(storage.createBucket).toHaveBeenCalledWith('avatars', limits);
    expect(storage.updateBucket).not.toHaveBeenCalled();
  });

  it('applies the limit to a bucket made before the limit existed', async () => {
    const { service, storage } = serviceWith(['avatars']);

    await service.ensureBucket('avatars', limits);

    expect(storage.updateBucket).toHaveBeenCalledWith('avatars', limits);
    expect(storage.createBucket).not.toHaveBeenCalled();
  });

  it('reports a limit that could not be applied, instead of carrying on unprotected', async () => {
    const { service, storage } = serviceWith(['avatars']);
    storage.updateBucket.mockResolvedValue({ error: new Error('forbidden') });

    await expect(service.ensureBucket('avatars', limits)).rejects.toThrow(
      'forbidden',
    );
  });
});
