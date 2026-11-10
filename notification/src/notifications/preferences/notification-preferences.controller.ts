import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId, JwtAuthGuard } from '@tilomnov/shared';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import {
  DEFAULT_PREFERENCES,
  NotificationPreferences,
  NotificationPreferencesService,
  SwitchablePreference,
} from './notification-preferences.service';

@ApiTags('notifications')
@UseGuards(JwtAuthGuard)
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  get(@CurrentUserId() userId: string): Promise<NotificationPreferences> {
    return this.preferences.get(userId);
  }

  @Patch()
  update(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferences> {
    // Only what was sent changes; every switch is a preference the service knows.
    const changes: Partial<NotificationPreferences> = {};
    for (const key of Object.keys(
      DEFAULT_PREFERENCES,
    ) as SwitchablePreference[]) {
      if (dto[key] !== undefined) changes[key] = dto[key];
    }
    return this.preferences.update(userId, changes);
  }
}
