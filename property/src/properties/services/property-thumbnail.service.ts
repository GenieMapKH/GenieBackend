import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PropertyPhotoStorage } from '../storage/property-photo-storage';

/** Photos worked on at once: each holds an original (up to 4 MB) in memory. */
const PARALLEL_PHOTOS = 3;

/** Photos read per database round trip while backfilling. */
const BACKFILL_BATCH = 50;

/**
 * Small copies of listing photos (`PropertyImage.thumbnailUrl`), so cards,
 * lists and the map download a fraction of the original. A photo without one
 * still works: the app shows the original instead.
 */
@Injectable()
export class PropertyThumbnailService {
  private readonly logger = new Logger(PropertyThumbnailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PropertyPhotoStorage,
  ) {}

  /**
   * The thumbnail URL of each uploaded photo, by its stored name. A photo
   * whose thumbnail could not be made maps to null: the upload itself must
   * not fail over it.
   */
  async createFor(fileNames: string[]): Promise<Map<string, string | null>> {
    const thumbnails = new Map<string, string | null>();
    await inParallel(fileNames, async (fileName) => {
      thumbnails.set(fileName, await this.tryCreate(fileName));
    });
    return thumbnails;
  }

  /**
   * Makes the missing thumbnails of photos uploaded before thumbnails
   * existed (or whose thumbnail failed). Safe to run again: it only reads
   * photos that still have none, and skips ones it cannot make.
   */
  async backfill(): Promise<{ made: number; failed: number }> {
    let made = 0;
    let failed = 0;
    let afterId: string | undefined;

    for (;;) {
      const rows = await this.prisma.propertyImage.findMany({
        where: {
          thumbnailUrl: null,
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        select: { id: true, url: true },
        orderBy: { id: 'asc' },
        take: BACKFILL_BATCH,
      });
      if (rows.length === 0) return { made, failed };
      afterId = rows[rows.length - 1].id;

      const urls = [...new Set(rows.map((row) => row.url))];
      await inParallel(urls, async (url) => {
        const fileName = this.storage.uploadedFileNameOf(url);
        const thumbnailUrl = fileName ? await this.tryCreate(fileName) : null;
        if (!thumbnailUrl) {
          failed++;
          return;
        }
        // Every row showing the same file shares its thumbnail.
        await this.prisma.propertyImage.updateMany({
          where: { url, thumbnailUrl: null },
          data: { thumbnailUrl },
        });
        made++;
      });
      this.logger.log(`Thumbnails: ${made} made, ${failed} skipped so far`);
    }
  }

  private async tryCreate(fileName: string): Promise<string | null> {
    try {
      return await this.storage.createThumbnail(fileName);
    } catch (error) {
      this.logger.error(`Could not make a thumbnail of ${fileName}`, error);
      return null;
    }
  }
}

/** Runs [work] for every item, at most [PARALLEL_PHOTOS] at a time. */
async function inParallel<T>(
  items: T[],
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      await work(items[next++]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_PHOTOS, items.length) }, worker),
  );
}
