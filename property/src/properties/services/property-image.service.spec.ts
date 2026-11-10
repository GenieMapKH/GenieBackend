import { BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@tilomnov/shared';
import { PropertyPhotoStorage } from '../storage/property-photo-storage';
import {
  MAX_PROPERTY_IMAGES,
  PropertyImageService,
} from './property-image.service';

const ME = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';
const LISTING = '33333333-3333-4333-8333-333333333333';
const OTHER_LISTING = '44444444-4444-4444-8444-444444444444';
const FILE = '55555555-5555-4555-8555-555555555555';
const PUBLIC = 'https://storage.test/storage/v1/object/public/property-images/';

describe('PropertyImageService', () => {
  const imageTable = {
    createMany: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  };
  const query = { findOwned: jest.fn() };
  const tx = {
    $executeRaw: jest.fn(),
    property: { findFirst: jest.fn() },
    propertyImage: imageTable,
  };
  const listingChanges = { changed: jest.fn() };
  const thumbnails = { createFor: jest.fn() };
  const client = {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `${PUBLIC}${path}` },
        }),
        createSignedUploadUrl: async (path: string) => ({
          data: { signedUrl: `https://upload.test/${path}` },
        }),
        remove: jest.fn(async () => ({ error: null })),
      }),
    },
  };
  let storage: SupabaseService;
  let photos: PropertyPhotoStorage;
  let images: PropertyImageService;
  let removed: string[];

  function listing(imageUrls: string[] = [], status = 'Draft') {
    return {
      id: LISTING,
      status,
      images: imageUrls.map((url, i) => ({ url, order: i + 1 })),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://storage.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    storage = new SupabaseService();
    (storage as unknown as { supabase: unknown }).supabase = client;
    photos = new PropertyPhotoStorage(storage);
    removed = [];
    jest
      .spyOn(storage, 'removeFiles')
      .mockImplementation(async (_bucket, paths) => {
        removed.push(...paths);
      });
    query.findOwned.mockResolvedValue(listing());
    tx.property.findFirst.mockImplementation(() => query.findOwned());
    imageTable.findMany.mockResolvedValue([]);
    thumbnails.createFor.mockImplementation(
      async (names: string[]) =>
        new Map(names.map((name) => [name, `${PUBLIC}${name}.thumb.jpg`])),
    );
    images = new PropertyImageService(
      {
        propertyImage: imageTable,
        $transaction: (run: (db: typeof tx) => unknown) => run(tx),
      } as never,
      query as never,
      photos,
      listingChanges as never,
      thumbnails as never,
    );
  });

  it('rechecks capacity under the listing lock when another confirmation filled the last place', async () => {
    tx.property.findFirst.mockResolvedValueOnce(
      listing(Array.from({ length: 30 }, (_, n) => `existing-${n}`)),
    );
    await expect(
      images.confirmUploads(ME, LISTING, [
        `${ME}/${LISTING}/${FILE}-front.jpg`,
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(imageTable.createMany).not.toHaveBeenCalled();
  });

  describe('upload URLs', () => {
    it("names each file inside the listing's own folder, in the order asked", async () => {
      const urls = await images.createUploadUrls(ME, LISTING, [
        'front door.jpg',
        'garden.jpg',
      ]);

      expect(urls).toHaveLength(2);
      expect(urls[0].fileName).toMatch(
        new RegExp(`^${ME}/${LISTING}/[0-9a-f-]{36}-front_door\\.jpg$`),
      );
      expect(urls[1].fileName).toMatch(/-garden\.jpg$/);
      expect(urls.every((url) => photos.isUploadedFileName(url.fileName))).toBe(
        true,
      );
    });

    it(`refuses to go past ${MAX_PROPERTY_IMAGES} photos`, async () => {
      query.findOwned.mockResolvedValue(
        listing(Array.from({ length: 29 }, (_, i) => `${PUBLIC}${i}`)),
      );

      await expect(
        images.createUploadUrls(ME, LISTING, ['a.jpg', 'b.jpg']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirming uploads', () => {
    const own = `${ME}/${LISTING}/${FILE}-front.jpg`;

    it('attaches files from its own folder, with their thumbnails', async () => {
      await images.confirmUploads(ME, LISTING, [own]);

      expect(thumbnails.createFor).toHaveBeenCalledWith([own]);
      expect(imageTable.createMany).toHaveBeenCalledWith({
        data: [
          {
            propertyId: LISTING,
            url: `${PUBLIC}${own}`,
            thumbnailUrl: `${PUBLIC}${own}.thumb.jpg`,
            order: 1,
          },
        ],
      });
    });

    it('still attaches a photo whose thumbnail could not be made', async () => {
      thumbnails.createFor.mockResolvedValueOnce(new Map([[own, null]]));

      await images.confirmUploads(ME, LISTING, [own]);

      expect(imageTable.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ thumbnailUrl: null })],
      });
    });

    it.each([
      [
        "another user's photo",
        `${SOMEONE_ELSE}/${OTHER_LISTING}/${FILE}-x.jpg`,
      ],
      [
        'a photo of another of my listings',
        `${ME}/${OTHER_LISTING}/${FILE}-x.jpg`,
      ],
      ['a photo from before folders existed', '1700000000000-123456789-x.jpg'],
      [
        'a path that climbs out of the folder',
        `${ME}/${LISTING}/../${SOMEONE_ELSE}/x.jpg`,
      ],
      ['a URL', 'https://evil.example/x.jpg'],
      ['a thumbnail', `${ME}/${LISTING}/${FILE}-front.jpg.thumb.jpg`],
    ])('refuses %s', async (_case, fileName) => {
      await expect(
        images.confirmUploads(ME, LISTING, [fileName]),
      ).rejects.toThrow(BadRequestException);
      expect(imageTable.createMany).not.toHaveBeenCalled();
    });

    it('does not attach the same file twice', async () => {
      query.findOwned.mockResolvedValue(listing([`${PUBLIC}${own}`]));

      await images.confirmUploads(ME, LISTING, [own, own]);

      expect(imageTable.createMany).not.toHaveBeenCalled();
      expect(thumbnails.createFor).not.toHaveBeenCalled();
    });
  });

  describe('removing photos', () => {
    const keep = `${PUBLIC}${ME}/${LISTING}/${FILE}-keep.jpg`;
    const drop = `${PUBLIC}${ME}/${LISTING}/${FILE}-drop.jpg`;

    it('takes the photo off the listing and deletes its file and thumbnail', async () => {
      query.findOwned.mockResolvedValue(listing([keep, drop]));

      await images.removeImages(ME, LISTING, [drop]);

      expect(imageTable.deleteMany).toHaveBeenCalledWith({
        where: { propertyId: LISTING, url: { in: [drop] } },
      });
      expect(removed).toEqual([
        `${ME}/${LISTING}/${FILE}-drop.jpg`,
        `${ME}/${LISTING}/${FILE}-drop.jpg.thumb.jpg`,
      ]);
    });

    it('ignores a URL the listing does not show, so removing twice is harmless', async () => {
      query.findOwned.mockResolvedValue(listing([keep]));

      await images.removeImages(ME, LISTING, [
        drop,
        'https://elsewhere.test/a.jpg',
      ]);

      expect(imageTable.deleteMany).not.toHaveBeenCalled();
      expect(removed).toEqual([]);
    });

    it('keeps a file another listing still shows', async () => {
      query.findOwned.mockResolvedValue(listing([drop]));
      imageTable.findMany.mockResolvedValueOnce([{ url: drop }]);

      await images.removeImages(ME, LISTING, [drop]);

      expect(imageTable.deleteMany).toHaveBeenCalled();
      expect(removed).toEqual([]);
    });

    it("never deletes a file in another user's folder", async () => {
      const theirs = `${PUBLIC}${SOMEONE_ELSE}/${OTHER_LISTING}/${FILE}-x.jpg`;
      query.findOwned.mockResolvedValue(listing([theirs]));

      await images.removeImages(ME, LISTING, [theirs]);

      expect(imageTable.deleteMany).toHaveBeenCalled();
      expect(removed).toEqual([]);
    });

    it('refreshes the public copy of a published listing', async () => {
      query.findOwned.mockResolvedValue(listing([drop], 'Active'));

      await images.removeImages(ME, LISTING, [drop]);

      expect(listingChanges.changed).toHaveBeenCalledWith(
        expect.objectContaining({ id: LISTING }),
      );
    });

    it('still succeeds when the file cannot be deleted', async () => {
      query.findOwned.mockResolvedValue(listing([drop]));
      jest
        .spyOn(storage, 'removeFiles')
        .mockRejectedValueOnce(new Error('storage down'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(
        images.removeImages(ME, LISTING, [drop]),
      ).resolves.toBeDefined();
      expect(imageTable.deleteMany).toHaveBeenCalled();
    });
  });

  describe('deleting an account', () => {
    it("deletes its own photos but never one another user's listing also shows", async () => {
      const mine = `${ME}/${LISTING}/${FILE}-mine.jpg`;
      const oldMine = '1700000000000-111-mine.jpg';
      // Attached to my listing from someone else's before folders existed.
      const theirs = '1700000000000-222-theirs.jpg';
      imageTable.findMany
        .mockResolvedValueOnce(
          [mine, oldMine, theirs].map((name) => ({ url: `${PUBLIC}${name}` })),
        )
        .mockResolvedValueOnce([{ url: `${PUBLIC}${theirs}` }]);

      await images.removeAllOwnedBy(ME);

      expect(removed).toEqual([
        mine,
        oldMine,
        `${mine}.thumb.jpg`,
        `${oldMine}.thumb.jpg`,
      ]);
    });

    it("never deletes a file in another user's folder", async () => {
      const inTheirFolder = `${SOMEONE_ELSE}/${OTHER_LISTING}/${FILE}-x.jpg`;
      imageTable.findMany
        .mockResolvedValueOnce([{ url: `${PUBLIC}${inTheirFolder}` }])
        .mockResolvedValueOnce([]);

      await images.removeAllOwnedBy(ME);

      expect(removed).toEqual([]);
    });
  });
});
