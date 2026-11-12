import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ExpiryReminderDto, serviceCallGuard } from '@tilomnov/shared';
import { ExpiryRemindersService } from './expiry-reminders.service';

@ApiExcludeController()
@UseGuards(serviceCallGuard('notification'))
@Controller({ path: 'internal/publishing-reminders', version: VERSION_NEUTRAL })
export class PublishingReminderController {
  constructor(private readonly reminders: ExpiryRemindersService) {}

  @Post('current')
  @HttpCode(200)
  async current(@Body() event: ExpiryReminderDto) {
    return { current: await this.reminders.isCurrent(event) };
  }
}
