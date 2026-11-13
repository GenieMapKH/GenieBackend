import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService, UploadBudgets } from '@tilomnov/shared';
import { PropertyPhotoStorage } from '../storage/property-photo-storage';

/** Includes Supabase's two-hour capability lifetime and ten minutes of upload grace. */
const RESERVATION_MS = 130 * 60 * 1000;
const MAX_OUTSTANDING = 60;
const MAX_STORED_IMAGES = 1024;

/** Reservations survive process/Redis restarts and account deletion. */
@Injectable()
export class PropertyUploadReservations
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PropertyUploadReservations.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PropertyPhotoStorage,
    private readonly budgets: UploadBudgets,
  ) {}

  async reserve(
    userId: string,
    propertyId: string,
    paths: string[],
  ): Promise<void> {
    if (!paths.length)
      throw new BadRequestException('Choose at least one photo');
    await this.budgets.take(userId, 'property', paths.length);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 8))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${propertyId}, 3))`;
      const property = await tx.property.findFirst({
        where: { id: propertyId, userId, status: { not: 'Deleted' } },
        select: { _count: { select: { images: true } } },
      });
      if (!property)
        throw new BadRequestException('Property is no longer available');
      const pending = { confirmedAt: null, cleanedAt: null };
      const [inListing, inAccount, stored] = await Promise.all([
        tx.propertyUploadReservation.count({
          where: { ...pending, propertyId },
        }),
        tx.propertyUploadReservation.count({ where: { ...pending, userId } }),
        tx.propertyImage.count({ where: { property: { userId } } }),
      ]);
      if (property._count.images + inListing + paths.length > 30)
        throw new BadRequestException(
          'A listing can have at most 30 uploaded or reserved photos',
        );
      if (
        inAccount + paths.length > MAX_OUTSTANDING ||
        stored + inAccount + paths.length > MAX_STORED_IMAGES
      )
        throw new BadRequestException('Account photo storage budget exceeded');
      await tx.propertyUploadReservation.createMany({
        data: paths.map((path) => ({
          path,
          userId,
          propertyId,
          expiresAt: new Date(Date.now() + RESERVATION_MS),
        })),
      });
    });
  }

  /** Called under the same listing lock as attachment and cleanup. */
  async confirm(
    tx: Prisma.TransactionClient,
    userId: string,
    propertyId: string,
    paths: string[],
  ): Promise<void> {
    if (!paths.length) return;
    const where = {
      userId,
      propertyId,
      path: { in: paths },
      cleanedAt: null,
      expiresAt: { gt: new Date() },
    };
    const reservations = await tx.propertyUploadReservation.findMany({
      where,
      select: { path: true },
    });
    if (reservations.length !== paths.length)
      throw new BadRequestException(
        'Unknown or expired image upload. Upload the photo again.',
      );
    await tx.propertyUploadReservation.updateMany({
      where,
      data: { confirmedAt: new Date() },
    });
  }

  onModuleInit(): void {
    void this.run();
  }
  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async run(): Promise<void> {
    try {
      await this.cleanup();
    } catch {
      this.logger.error(
        'Abandoned photo cleanup failed; reservations remain charged for retry',
      );
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.run(), 60000);
        this.timer.unref();
      }
    }
  }

  async cleanup(): Promise<void> {
    const expired = await this.prisma.propertyUploadReservation.findMany({
      where: { expiresAt: { lt: new Date() }, cleanedAt: null },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
    for (const reservation of expired) {
      if (this.stopped) return;
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reservation.propertyId}, 3))`;
          const current = await tx.propertyUploadReservation.findUnique({
            where: { path: reservation.path },
          });
          if (!current || current.cleanedAt || current.expiresAt > new Date())
            return;
          if (
            !current.path.startsWith(
              `${current.userId}/${current.propertyId}/`,
            ) ||
            !this.storage.isUploadedFileName(current.path)
          )
            throw new Error('Invalid reserved photo ownership');
          const attached = await tx.propertyImage.count({
            where: { url: this.storage.getPublicUrl(current.path) },
          });
          if (!attached) await this.storage.removeUploadedFiles([current.path]);
          await tx.propertyUploadReservation.update({
            where: { path: current.path },
            data: { cleanedAt: new Date() },
          });
        },
        { timeout: 30000 },
      );
    }
    // Keep a bounded history, but never forget an object whose cleanup failed.
    const old = new Date(Date.now() - 30 * 86400000);
    await this.prisma.propertyUploadReservation.deleteMany({
      where: { cleanedAt: { lt: old } },
    });
    await this.prisma.uploadBudget.deleteMany({ where: { day: { lt: old } } });
  }
}
