import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';

/** What a user can switch off. Security alerts and calls always arrive. */
export interface NotificationPreferences {
  chatMessages: boolean;
  promotions: boolean;
  /** New listings matching one of their saved searches. */
  savedSearchAlerts: boolean;
  /** New listings from people they follow. */
  followedListings: boolean;
  /** Price drops and sales of listings they saved. */
  savedListingUpdates: boolean;
}

/** One kind of push a user can turn off. */
export type SwitchablePreference = keyof NotificationPreferences;

/** Everyone starts with everything on; the app lets them turn things off. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  chatMessages: true,
  promotions: true,
  savedSearchAlerts: true,
  followedListings: true,
  savedListingUpdates: true,
};

const PREFERENCE_SELECT = {
  chatMessages: true,
  promotions: true,
  savedSearchAlerts: true,
  followedListings: true,
  savedListingUpdates: true,
} as const;

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreferences.findUnique({
      where: { userId },
      select: PREFERENCE_SELECT,
    });
    return row ?? DEFAULT_PREFERENCES;
  }

  async update(
    userId: string,
    changes: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    return this.prisma.notificationPreferences.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_PREFERENCES, ...changes },
      update: changes,
      select: PREFERENCE_SELECT,
    });
  }
}
