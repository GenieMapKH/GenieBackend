import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { AdvertisementsService } from './advertisements.service';

describe('administrator photo advertisements', () => {
  const actor = '00000000-0000-4000-8000-000000000001';
  const id = '00000000-0000-4000-8000-000000000002';
  const path = `${actor}/${id}`;
  const rows = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  };
  const prisma = {
    advertisement: rows,
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const storage = {
    ensureBucket: jest.fn(),
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn(),
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
    publicUrl: jest.fn(),
    removeFiles: jest.fn(),
  };
  const service = new AdvertisementsService(prisma as never, storage as never);
  let photo: Buffer;
  beforeAll(async () => {
    photo = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    rows.findUnique.mockResolvedValue(null);
    rows.count.mockResolvedValue(0);
    rows.create.mockResolvedValue({
      id,
      imageUrl: 'https://storage.test/ads/photo.jpg',
    });
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );
    storage.createSignedDownloadUrl.mockResolvedValue(
      'https://signed.test/upload',
    );
    storage.downloadFile.mockResolvedValue(photo);
    storage.publicUrl.mockReturnValue('https://storage.test/ads/photo.jpg');
  });
  it('normalizes real uploaded pictures and exposes only approved public metadata', async () => {
    await expect(service.create(actor, path)).resolves.toEqual({
      id,
      imageUrl: 'https://storage.test/ads/photo.jpg',
    });
    const [bucket, file, bytes, type] = storage.uploadFile.mock.calls[0];
    expect(bucket).toBe('advertisements');
    expect(file).toBe(`${id}.jpg`);
    expect(type).toBe('image/jpeg');
    expect((await sharp(bytes as Buffer).metadata()).format).toBe('jpeg');
    expect(storage.removeFiles).toHaveBeenCalledWith('advertisement-uploads', [
      path,
    ]);
    await service.list();
    expect(rows.findMany).toHaveBeenCalledWith({
      select: { id: true, imageUrl: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
  it('rejects copied paths, missing uploads, executable content and oversized files', async () => {
    await expect(service.create(id, path)).rejects.toThrow(BadRequestException);
    await expect(service.create(actor, '../file')).rejects.toThrow(
      BadRequestException,
    );
    storage.createSignedDownloadUrl.mockResolvedValue(null);
    await expect(service.create(actor, path)).rejects.toThrow(
      BadRequestException,
    );
    storage.createSignedDownloadUrl.mockResolvedValue('signed');
    storage.downloadFile.mockResolvedValue(
      Buffer.from('<script>alert(1)</script>'),
    );
    await expect(service.create(actor, path)).rejects.toThrow(
      BadRequestException,
    );
    storage.downloadFile.mockResolvedValue(Buffer.alloc(5 * 1024 * 1024 + 1));
    await expect(service.create(actor, path)).rejects.toThrow(
      BadRequestException,
    );
    expect(rows.create).not.toHaveBeenCalled();
  });
  it('makes confirmation retry safe after the staging upload was removed', async () => {
    rows.findUnique.mockResolvedValue({ id, imageUrl: 'approved' });
    expect(await service.create(actor, path)).toEqual({
      id,
      imageUrl: 'approved',
    });
    expect(storage.downloadFile).not.toHaveBeenCalled();
  });
  it('serializes the bounded active collection and removes only its own advertisement file', async () => {
    rows.count.mockResolvedValue(100);
    await expect(service.create(actor, path)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$executeRaw).toHaveBeenCalled();
    await service.remove(id);
    expect(rows.deleteMany).toHaveBeenCalledWith({ where: { id } });
    expect(storage.removeFiles).toHaveBeenCalledWith('advertisements', [
      `${id}.jpg`,
    ]);
  });
});
