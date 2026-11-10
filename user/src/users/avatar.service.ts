import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PrismaService,
  PUBLIC_IMAGE_TYPES,
  SupabaseService,
} from '@tilomnov/shared';
import { isGooglePhotoUrl } from './avatar-url';
import { UsersService } from './users.service';

/** Public bucket: a profile picture is shown to everyone. One folder per user. */
const BUCKET = 'avatars';
/** The app compresses a picture to under 1 MB (`ImageUploadPolicy.avatar`); storage refuses more than this. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** Only used to ask storage whether a file is there. */
const EXISTENCE_CHECK_SECONDS = 60;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UPLOAD_PATH = new RegExp(`^(${UUID})/${UUID}$`, 'i');

/**
 * The profile picture: one the user uploads (taken with the camera or chosen
 * from their photos), or their Google account's photo.
 */
@Injectable()
export class AvatarService implements OnModuleInit {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseService,
    private readonly users: UsersService,
  ) {}

  async onModuleInit() {
    try {
      await this.storage.ensureBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_AVATAR_BYTES,
        allowedMimeTypes: PUBLIC_IMAGE_TYPES,
      });
    } catch (error) {
      this.logger.error(
        `Could not prepare the ${BUCKET} bucket: ${(error as Error).message}`,
      );
    }
  }

  /** One place to upload one picture to. It is not shown until `useUpload` confirms it. */
  async createUpload(userId: string) {
    const path = `${userId}/${randomUUID()}`;
    return {
      path,
      uploadUrl: await this.storage.createSignedUploadUrl(BUCKET, path),
    };
  }

  /** Makes a picture uploaded to `path` the profile picture. */
  async useUpload(userId: string, path: string) {
    const owner = UPLOAD_PATH.exec(path)?.[1];
    if (owner?.toLowerCase() !== userId.toLowerCase()) {
      throw new BadRequestException('Unknown picture');
    }
    if (
      !(await this.storage.createSignedDownloadUrl(
        BUCKET,
        path,
        EXISTENCE_CHECK_SECONDS,
      ))
    ) {
      throw new BadRequestException('The picture was not uploaded');
    }
    return this.replace(userId, this.storage.publicUrl(BUCKET, path));
  }

  /**
   * "Sync from Google account": the picture is the Google photo, and follows
   * it when it changes (the authentication service updates it at each Google
   * sign-in for as long as the picture is a Google photo).
   */
  async useGooglePhoto(userId: string, photoUrl: string) {
    if (!isGooglePhotoUrl(photoUrl)) {
      throw new BadRequestException('Not a Google profile photo');
    }
    return this.replace(userId, photoUrl);
  }

  /** Back to no picture. */
  remove(userId: string) {
    return this.replace(userId, null);
  }

  /** Deletes every picture the user uploaded. Called before the account is deleted. */
  removeAllOf(userId: string): Promise<void> {
    return this.storage.removeFolder(BUCKET, userId);
  }

  private async replace(userId: string, avatarUrl: string | null) {
    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    await this.users.publicViewChanged(userId);

    await this.removeUploadedFile(userId, previous?.avatarUrl);
    return this.users.getProfile(userId);
  }

  /** The picture that was just replaced is of no use to anyone. A leftover file is not worth failing for. */
  private async removeUploadedFile(
    userId: string,
    url: string | null | undefined,
  ): Promise<void> {
    const folder = this.storage.publicUrl(BUCKET, `${userId}/`);
    if (!url?.startsWith(folder)) return;

    try {
      await this.storage.removeFiles(BUCKET, [
        `${userId}/${url.slice(folder.length)}`,
      ]);
    } catch (error) {
      this.logger.warn(
        `Old avatar of ${userId} was not removed: ${(error as Error).message}`,
      );
    }
  }
}
