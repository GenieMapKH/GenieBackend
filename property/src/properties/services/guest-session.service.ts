import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';

/** Tracks anonymous devices that browse without an account. */
@Injectable()
export class GuestSessionService {
  private readonly logger = new Logger(GuestSessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(
    deviceId?: string,
  ): Promise<{ success: boolean; sessionId?: string }> {
    if (!deviceId) return { success: false };

    try {
      const session = await this.prisma.guestSession.upsert({
        where: { deviceId },
        update: { lastSeen: new Date() },
        create: { deviceId },
      });
      return { success: true, sessionId: session.id };
    } catch (error) {
      this.logger.error(
        `Failed to register guest session: ${(error as Error).message}`,
      );
      return { success: false };
    }
  }
}
