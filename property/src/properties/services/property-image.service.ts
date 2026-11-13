import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PropertyPhotoStorage } from '../storage/property-photo-storage';
import { PropertyQueryService } from './property-query.service';
import { ListingChanges } from './listing-changes.service';
import { PropertyThumbnailService } from './property-thumbnail.service';
import { PropertyUploadReservations } from './property-upload-reservations';

/** The most photos one listing can have. The app stops at the same number. */
export const MAX_PROPERTY_IMAGES = 30;

/**
 * A listing's photos: presigned upload URLs, then confirm what was uploaded;
 * and taking photos off again.
 */
@Injectable()
export class PropertyImageService {
  private readonly logger = new Logger(PropertyImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly query: PropertyQueryService,
    private readonly storage: PropertyPhotoStorage,
    private readonly listingChanges: ListingChanges,
    private readonly thumbnails: PropertyThumbnailService,
    private readonly reservations: PropertyUploadReservations,
  ) {}

  /** One upload URL per name, in the same order, inside this listing's own folder. */
  async createUploadUrls(
    userId: string,
    propertyId: string,
    fileNames: string[],
  ) {
    const property = await this.query.findOwned(userId, propertyId);
    this.ensureRoomFor(property.images.length, fileNames.length);
    const paths = fileNames.map((name) =>
      this.storage.newFileName(uploadFolder(userId, propertyId), name),
    );
    await this.reservations.reserve(userId, propertyId, paths);
    return this.storage.signUploadPaths(paths);
  }

  /**
   * Attaches uploaded files to the property, after its existing images. Only
   * files from this listing's own folder are accepted: a name copied from
   * someone else's photo is refused. Confirming the same file again changes
   * nothing.
   */
  async confirmUploads(
    userId: string,
    propertyId: string,
    fileNames: string[],
  ) {
    const property = await this.query.findOwned(userId, propertyId);
    const folder = `${uploadFolder(userId, propertyId)}/`;
    const isOwnUpload = (fileName: string) =>
      fileName.startsWith(folder) &&
      this.storage.isUploadedFileName(fileName) &&
      !this.storage.isThumbnailName(fileName);
    if (!fileNames.every(isOwnUpload)) {
      throw new BadRequestException('Unknown image file');
    }

    const attached = new Set(property.images.map((image) => image.url));
    const added = [...new Set(fileNames)].filter(
      (fileName) => !attached.has(this.storage.getPublicUrl(fileName)),
    );
    this.ensureRoomFor(property.images.length, added.length);

    if (added.length > 0) {
      const thumbnails = await this.thumbnails.createFor(added);
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${propertyId}, 3))`;
        const current = await tx.property.findFirst({
          where: { id: propertyId, userId, status: { not: 'Deleted' } },
          select: { images: { select: { url: true, order: true } } },
        });
        if (!current)
          throw new BadRequestException('Property is no longer available');
        const attachedNow = new Set(current.images.map((image) => image.url));
        const fresh = added.filter(
          (fileName) => !attachedNow.has(this.storage.getPublicUrl(fileName)),
        );
        await this.reservations.confirm(tx, userId, propertyId, fresh);
        this.ensureRoomFor(current.images.length, fresh.length);
        const lastOrder = Math.max(
          0,
          ...current.images.map((image) => image.order),
        );
        if (fresh.length)
          await tx.propertyImage.createMany({
            data: fresh.map((fileName, index) => ({
              propertyId,
              url: this.storage.getPublicUrl(fileName),
              thumbnailUrl: thumbnails.get(fileName) ?? null,
              order: lastOrder + index + 1,
            })),
          });
      });

      // New photos of a published listing should show up right away.
      if (property.status === 'Active') {
        await this.listingChanges.changed(property);
      }
    }
    return this.query.findOwned(userId, propertyId);
  }

  /**
   * Takes the photos with these URLs off the listing, then deletes their
   * files. A URL the listing does not show is ignored, so removing twice is
   * harmless. A file another listing still shows is kept.
   */
  async removeImages(userId: string, propertyId: string, urls: string[]) {
    const property = await this.query.findOwned(userId, propertyId);
    const wanted = new Set(urls);
    const removed = property.images
      .map((image) => image.url)
      .filter((url) => wanted.has(url));
    if (removed.length === 0) return property;

    await this.prisma.propertyImage.deleteMany({
      where: { propertyId, url: { in: removed } },
    });
    if (property.status === 'Active') {
      await this.listingChanges.changed(property);
    }

    const stillShown = await this.prisma.propertyImage.findMany({
      where: { url: { in: removed } },
      select: { url: true },
    });
    const shownUrls = new Set(stillShown.map((image) => image.url));
    await this.deleteFilesQuietly(
      this.ownFileNames(
        userId,
        removed.filter((url) => !shownUrls.has(url)),
      ),
    );
    return this.query.findOwned(userId, propertyId);
  }

  /**
   * Deletes the stored photos of every listing the user ever made, deleted
   * ones included. Called before the account itself is deleted, while the
   * database still says which files those are.
   *
   * Before photos had folders, any file name could be attached to any
   * listing. A file that another user's listing also shows is left alone, so
   * deleting an account can never take someone else's photos with it.
   */
  async removeAllOwnedBy(userId: string): Promise<void> {
    const images = await this.prisma.propertyImage.findMany({
      where: { property: { userId } },
      select: { url: true },
    });
    const urls = [...new Set(images.map((image) => image.url))];
    if (urls.length === 0) return;

    const shared = await this.prisma.propertyImage.findMany({
      where: { url: { in: urls }, property: { userId: { not: userId } } },
      select: { url: true },
    });
    const sharedUrls = new Set(shared.map((image) => image.url));

    await this.storage.removeUploadedFiles(
      this.ownFileNames(
        userId,
        urls.filter((url) => !sharedUrls.has(url)),
      ),
    );
  }

  /**
   * The stored files behind [urls] that [userId] may delete: those in the
   * user's own folder, or from before photos had folders.
   */
  private ownFileNames(userId: string, urls: string[]): string[] {
    return urls
      .map((url) => this.storage.uploadedFileNameOf(url))
      .filter((fileName): fileName is string => fileName !== null)
      .filter(
        (fileName) =>
          this.storage.isLegacyFileName(fileName) ||
          fileName.startsWith(`${userId}/`),
      );
  }

  /**
   * The photos are already off the listing, so a file that cannot be deleted
   * only wastes space: it is logged rather than failing the request.
   */
  private async deleteFilesQuietly(fileNames: string[]): Promise<void> {
    if (fileNames.length === 0) return;
    try {
      await this.storage.removeUploadedFiles(fileNames);
    } catch (error) {
      this.logger.error(
        `Could not delete ${fileNames.length} removed photo file(s)`,
        error,
      );
    }
  }

  private ensureRoomFor(existing: number, added: number) {
    if (existing + added > MAX_PROPERTY_IMAGES) {
      throw new BadRequestException(
        `A listing can have at most ${MAX_PROPERTY_IMAGES} photos`,
      );
    }
  }
}

/** Where a listing's photos are stored: one folder per owner, then per listing. */
function uploadFolder(userId: string, propertyId: string): string {
  return `${userId}/${propertyId}`;
}
