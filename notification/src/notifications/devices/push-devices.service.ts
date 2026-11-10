import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PushTarget } from '../delivery/push-sender';
import { SwitchablePreference } from '../preferences/notification-preferences.service';

/** One account rarely has this many devices; past it the oldest are dropped. */
export const MAX_DEVICES_PER_USER = 20;

const TARGET_FIELDS = {
  id: true,
  token: true,
  platform: true,
  locale: true,
} as const;

/** Who is registering a device: the account, and the signed-in session doing it. */
export interface DeviceOwner {
  userId: string;
  sessionId: string | null;
}

export interface DeviceRegistration {
  token: string;
  platform: PushTarget['platform'];
  locale: PushTarget['locale'];
}

/**
 * The devices each account can be reached on. A token belongs to one
 * account and session at a time: signing in as someone else on a phone moves
 * its token to them, so the previous account's pushes stop arriving there.
 */
@Injectable()
export class PushDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    owner: DeviceOwner,
    device: DeviceRegistration,
  ): Promise<void> {
    const fields = {
      userId: owner.userId,
      sessionId: owner.sessionId,
      platform: device.platform,
      locale: device.locale,
    };
    await this.prisma.pushDevice.upsert({
      where: { token: device.token },
      create: { token: device.token, ...fields },
      update: fields,
    });
    await this.dropOldestBeyondLimit(owner.userId);
  }

  /** The app stops receiving pushes here, e.g. before it signs out. Only the owner can. */
  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
  }

  /** A signed-out device must not keep showing the account's notifications. */
  async forgetSession(sessionId: string): Promise<number> {
    const { count } = await this.prisma.pushDevice.deleteMany({
      where: { sessionId },
    });
    return count;
  }

  /** Devices whose token no longer reaches them. */
  async forget(ids: string[]): Promise<number> {
    const { count } = await this.prisma.pushDevice.deleteMany({
      where: { id: { in: ids } },
    });
    return count;
  }

  /**
   * Where to reach [userId], except on the session [exceptSessionId] (the
   * device that caused the notification). None for a hidden account.
   */
  async targetsOf(
    userId: string,
    options: { exceptSessionId?: string | null } = {},
  ): Promise<PushTarget[]> {
    const except = options.exceptSessionId;
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        userId,
        user: { deactivatedAt: null },
        // `not` alone would also leave out devices registered without a session.
        ...(except && {
          OR: [{ sessionId: null }, { sessionId: { not: except } }],
        }),
      },
      select: TARGET_FIELDS,
    });
    return devices.flatMap(asTarget);
  }

  /**
   * Every device whose account allows promotions, [pageSize] at a time, so a
   * large audience is never loaded at once. Ordered by id, so a page is never
   * skipped or read twice while devices come and go.
   */
  async *promotionAudience(pageSize: number): AsyncGenerator<PushTarget[]> {
    let after: string | undefined;
    for (;;) {
      const page = await this.prisma.pushDevice.findMany({
        where: {
          ...(after && { id: { gt: after } }),
          user: {
            deactivatedAt: null,
            OR: [
              { notificationPreferences: { is: null } },
              { notificationPreferences: { is: { promotions: true } } },
            ],
          },
        },
        orderBy: { id: 'asc' },
        take: pageSize,
        select: TARGET_FIELDS,
      });
      if (page.length === 0) return;
      yield page.flatMap(asTarget);
      if (page.length < pageSize) return;
      after = page[page.length - 1].id;
    }
  }

  /**
   * The devices of each of [userIds] whose account allows [preference]
   * (on until turned off), in one read. Accounts with none are left out.
   */
  async targetsByUser(
    userIds: string[],
    preference: SwitchablePreference,
  ): Promise<Map<string, PushTarget[]>> {
    const byUser = new Map<string, PushTarget[]>();
    if (userIds.length === 0) return byUser;
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        userId: { in: [...new Set(userIds)] },
        user: {
          deactivatedAt: null,
          OR: [
            { notificationPreferences: { is: null } },
            { notificationPreferences: { is: { [preference]: true } } },
          ],
        },
      },
      select: { ...TARGET_FIELDS, userId: true },
    });
    for (const { userId, ...device } of devices) {
      byUser.set(userId, [...(byUser.get(userId) ?? []), ...asTarget(device)]);
    }
    return byUser;
  }

  private async dropOldestBeyondLimit(userId: string): Promise<void> {
    const extra = await this.prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip: MAX_DEVICES_PER_USER,
      select: { id: true },
    });
    if (extra.length > 0) await this.forget(extra.map((device) => device.id));
  }
}

const PLATFORMS: readonly string[] = ['android', 'ios', 'web'];
const LOCALES: readonly string[] = ['en', 'km'];

/** The database checks both columns; this keeps the types honest anyway. */
function asTarget(row: {
  id: string;
  token: string;
  platform: string;
  locale: string;
}): PushTarget[] {
  if (!PLATFORMS.includes(row.platform)) return [];
  return [
    {
      id: row.id,
      token: row.token,
      platform: row.platform as PushTarget['platform'],
      locale: (LOCALES.includes(row.locale)
        ? row.locale
        : 'en') as PushTarget['locale'],
    },
  ];
}
