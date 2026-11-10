import { PropertyThumbnailService } from './property-thumbnail.service';

const PUBLIC = 'https://storage.test/property-images/';

describe('PropertyThumbnailService', () => {
  const imageTable = { findMany: jest.fn(), updateMany: jest.fn() };
  const storage = {
    createThumbnail: jest.fn(),
    uploadedFileNameOf: jest.fn(),
  };
  let service: PropertyThumbnailService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    storage.createThumbnail.mockImplementation(
      async (name: string) => `${PUBLIC}${name}.thumb.jpg`,
    );
    storage.uploadedFileNameOf.mockImplementation((url: string) =>
      url.startsWith(PUBLIC) ? url.slice(PUBLIC.length) : null,
    );
    service = new PropertyThumbnailService(
      { propertyImage: imageTable } as never,
      storage as never,
    );
  });

  describe('createFor', () => {
    it('maps each photo to its thumbnail, and a failed one to null', async () => {
      storage.createThumbnail.mockImplementation(async (name: string) => {
        if (name === 'broken.jpg') throw new Error('not a picture');
        return `${PUBLIC}${name}.thumb.jpg`;
      });

      const thumbnails = await service.createFor([
        'a.jpg',
        'broken.jpg',
        'b.jpg',
        'c.jpg',
      ]);

      expect([...thumbnails.entries()].sort()).toEqual([
        ['a.jpg', `${PUBLIC}a.jpg.thumb.jpg`],
        ['b.jpg', `${PUBLIC}b.jpg.thumb.jpg`],
        ['broken.jpg', null],
        ['c.jpg', `${PUBLIC}c.jpg.thumb.jpg`],
      ]);
    });
  });

  describe('backfill', () => {
    it('fills photos without a thumbnail, page by page, and skips what it cannot make', async () => {
      imageTable.findMany
        .mockResolvedValueOnce([
          { id: '1', url: `${PUBLIC}a.jpg` },
          { id: '2', url: `${PUBLIC}a.jpg` },
          { id: '3', url: 'https://elsewhere.test/x.jpg' },
        ])
        .mockResolvedValueOnce([{ id: '4', url: `${PUBLIC}b.jpg` }])
        .mockResolvedValueOnce([]);

      const result = await service.backfill();

      expect(result).toEqual({ made: 2, failed: 1 });
      expect(imageTable.updateMany).toHaveBeenCalledTimes(2);
      expect(imageTable.updateMany).toHaveBeenCalledWith({
        where: { url: `${PUBLIC}a.jpg`, thumbnailUrl: null },
        data: { thumbnailUrl: `${PUBLIC}a.jpg.thumb.jpg` },
      });
      // Each page starts after the last row of the one before.
      expect(imageTable.findMany.mock.calls[1][0].where).toEqual({
        thumbnailUrl: null,
        id: { gt: '3' },
      });
    });
  });
});
