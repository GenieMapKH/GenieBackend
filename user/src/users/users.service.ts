import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JsonCache, PrismaService } from '@tilomnov/shared';
import { isGooglePhotoUrl } from './avatar-url';
import { UpdateProfileDto, USERNAME_PATTERN } from './dto/update-profile.dto';
import {
  PROPERTY_CONTENT,
  RemoteAccountContent,
} from './remote-account-content';

/** The columns the owner's own profile is built from. Never the password hash. */
const PROFILE_SELECT = {
  id: true,
  email: true,
  phone: true,
  emailVerified: true,
  phoneVerified: true,
  username: true,
  name: true,
  firstName: true,
  lastName: true,
  sex: true,
  role: true,
  createdAt: true,
  firebaseUid: true,
  avatarUrl: true,
  hasPassword: true,
} as const;

interface ProfileRow {
  firebaseUid: string | null;
  avatarUrl: string | null;
  hasPassword: boolean;
}

/** What `GET /users/me` returns: the row, plus two facts the app would otherwise have to work out. */
function toProfile<Row extends ProfileRow>(row: Row) {
  return {
    ...row,
    // An account without a Google identity can only have been made with a
    // password, whatever a row written by an older backend says.
    hasPassword: row.hasPassword || !row.firebaseUid,
    /** True while "Sync from Google account" is on. */
    avatarFromGoogle: !!row.avatarUrl && isGooglePhotoUrl(row.avatarUrl),
  };
}

/** What any signed-in user may see about another user. No contact details. */
const PUBLIC_PROFILE_SELECT = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  createdAt: true,
} as const;

/** Whether a username may be chosen, and if not why. */
export interface UsernameAvailability {
  /** The username as it would be saved (trimmed, lowercase). */
  username: string;
  available: boolean;
  reason: 'invalid' | 'taken' | null;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Short, because a name or photo set by Google sign-in (another service) cannot clear it. */
const PUBLIC_PROFILE_TTL_SECONDS = 120;

function publicProfileKey(userId: string): string {
  return `users:public-profile:${userId}`;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: JsonCache,
    @Inject(PROPERTY_CONTENT) private readonly properties: RemoteAccountContent,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toProfile(user);
  }

  /**
   * Shown on every chat and listing of that user, so it is read constantly.
   * A deactivated account is hidden, as if it did not exist.
   */
  getPublicProfile(userId: string) {
    return this.cache.remember(
      publicProfileKey(userId),
      PUBLIC_PROFILE_TTL_SECONDS,
      async () => {
        const user = await this.prisma.user.findFirst({
          where: { id: userId, deactivatedAt: null },
          select: PUBLIC_PROFILE_SELECT,
        });
        if (!user) {
          throw new NotFoundException('User not found');
        }
        return user;
      },
    );
  }

  /**
   * Whether `input` could be this user's username right now: well formed, and
   * not another account's. The user's own current username counts as available.
   *
   * This is only for showing the answer while someone types. Saving is what
   * decides: two people can ask about the same free name, and only the first
   * save wins (the unique index refuses the second with a 409).
   */
  async checkUsername(
    userId: string,
    input: string,
  ): Promise<UsernameAvailability> {
    const username = input.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      return { username, available: false, reason: 'invalid' };
    }

    const owner = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    const taken = owner !== null && owner.id !== userId;
    return { username, available: !taken, reason: taken ? 'taken' : null };
  }

  /**
   * Call when what others see of the user changed (name, picture, or whether
   * the account is hidden), so they see it at once instead of when the caches
   * expire. Two things are cached: the public profile, and the user's
   * published listings, which carry the owner's name and picture. The listings
   * belong to the property service, which is asked to drop them; if it cannot
   * be reached they expire on their own within a minute.
   */
  async publicViewChanged(userId: string): Promise<void> {
    await Promise.all([
      this.cache.delete(publicProfileKey(userId)),
      this.properties.notifyVisibilityChanged(userId),
    ]);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.phone !== undefined)
      throw new BadRequestException(
        'Change or verify your phone number through Account Security.',
      );
    try {
      const profile = await this.prisma.user.update({
        where: { id: userId },
        data: dto,
        select: PROFILE_SELECT,
      });
      await this.publicViewChanged(userId);
      return toProfile(profile);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(await this.takenFieldMessage(userId, dto));
      }
      throw error;
    }
  }

  /** Username and phone are both unique; says which of the two someone else already has. */
  private async takenFieldMessage(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<string> {
    if (dto.username) {
      const owner = await this.prisma.user.findUnique({
        where: { username: dto.username },
        select: { id: true },
      });
      if (owner && owner.id !== userId) return 'Username is already taken';
    }
    return 'Phone number is already taken';
  }
}
