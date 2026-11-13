import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';

/** Remembers when each user was last connected to chat. */
@Injectable()
export class PresenceService {
  constructor(private readonly prisma: PrismaService) {}

  async isVisible(userId: string): Promise<boolean> {
    return (
      (await this.prisma.user.findFirst({
        where: { id: userId, deactivatedAt: null },
        select: { id: true },
      })) !== null
    );
  }

  /** Records that the user just went offline and returns that moment. */
  async markLastSeen(userId: string): Promise<Date> {
    const lastSeenAt = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt },
      select: { id: true },
    });
    return lastSeenAt;
  }

  /** When the user was last connected, or null if never (or an unknown or deactivated user). */
  async getLastSeen(userId: string): Promise<Date | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deactivatedAt: null },
      select: { lastSeenAt: true },
    });
    return user?.lastSeenAt ?? null;
  }
}
