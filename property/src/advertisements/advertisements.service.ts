import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  PrismaService,
  SupabaseService,
  PUBLIC_IMAGE_TYPES,
} from '@tilomnov/shared';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { AD_PATH } from './advertisements.dto';

const UPLOADS = 'advertisement-uploads';
const PUBLIC = 'advertisements';
const MAX_BYTES = 5 * 1024 * 1024;
const AD_COLUMNS = { id: true, imageUrl: true, width: true, height: true };
@Injectable()
export class AdvertisementsService implements OnModuleInit {
  private readonly logger = new Logger(AdvertisementsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseService,
  ) {}
  async onModuleInit() {
    try {
      await this.storage.ensureBucket(UPLOADS, {
        public: false,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: PUBLIC_IMAGE_TYPES,
      });
      await this.storage.ensureBucket(PUBLIC, {
        public: true,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: ['image/jpeg'],
      });
    } catch (error) {
      this.logger.error(
        `Advertisement storage could not be prepared: ${(error as Error).message}`,
      );
    }
  }
  list() {
    return this.prisma.advertisement.findMany({
      select: AD_COLUMNS,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async upload(actorId: string) {
    const path = `${actorId}/${randomUUID()}`;
    return {
      path,
      uploadUrl: await this.storage.createSignedUploadUrl(UPLOADS, path),
    };
  }
  async create(actorId: string, path: string) {
    if (
      !AD_PATH.test(path) ||
      path.split('/')[0].toLowerCase() !== actorId.toLowerCase()
    )
      throw new BadRequestException('Unknown advertisement upload');
    const existing = await this.prisma.advertisement.findUnique({
      where: { imagePath: path },
      select: AD_COLUMNS,
    });
    if (existing) return existing;
    if (!(await this.storage.createSignedDownloadUrl(UPLOADS, path, 60)))
      throw new BadRequestException('Upload the advertisement first');
    const bytes = await this.storage.downloadFile(UPLOADS, path);
    if (bytes.length > MAX_BYTES)
      throw new BadRequestException('Advertisement image is too large');
    let image: Buffer;
    let width: number;
    let height: number;
    try {
      const normalized = await sharp(bytes, {
        limitInputPixels: 40000000,
        failOn: 'error',
      })
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      image = normalized.data;
      width = normalized.info.width;
      height = normalized.info.height;
    } catch {
      throw new BadRequestException('Please upload a valid image');
    }
    const id = path.split('/')[1];
    const publicPath = `${id}.jpg`;
    await this.storage.uploadFile(PUBLIC, publicPath, image, 'image/jpeg');
    const ad = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242, 1)`;
      const previous = await tx.advertisement.findUnique({
        where: { imagePath: path },
        select: AD_COLUMNS,
      });
      if (previous) return previous;
      if ((await tx.advertisement.count()) >= 100)
        throw new BadRequestException(
          'Remove an existing ad before adding more (100 maximum)',
        );
      return tx.advertisement.create({
        data: {
          id,
          imagePath: path,
          imageUrl: this.storage.publicUrl(PUBLIC, publicPath),
          width,
          height,
        },
        select: AD_COLUMNS,
      });
    });
    await this.cleanup(UPLOADS, path);
    return ad;
  }
  async remove(id: string) {
    await this.prisma.advertisement.deleteMany({ where: { id } });
    await this.cleanup(PUBLIC, `${id}.jpg`);
  }
  private async cleanup(bucket: string, path: string) {
    try {
      await this.storage.removeFiles(bucket, [path]);
    } catch (error) {
      this.logger.error(
        `Unused advertisement image could not be removed: ${(error as Error).message}`,
      );
    }
  }
}
