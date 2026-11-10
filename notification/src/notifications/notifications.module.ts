import { Logger, Module } from '@nestjs/common';
import { AdminGuard, RevokedSessions } from '@tilomnov/shared';
import { CallNotifier } from './calls/call-notifier';
import { ChatMessageNotifier } from './chat/chat-message-notifier';
import { DisabledPushSender } from './delivery/disabled-push-sender';
import { FirebasePushSender } from './delivery/firebase-push-sender';
import { PushDeliveryService } from './delivery/push-delivery.service';
import { PushSender } from './delivery/push-sender';
import { PushDevicesController } from './devices/push-devices.controller';
import { PushDevicesService } from './devices/push-devices.service';
import { SessionSignOutListener } from './devices/session-sign-out.listener';
import { InternalNotificationsController } from './internal/internal-notifications.controller';
import { ListingAlertNotifier } from './listings/listing-alert-notifier';
import { NotificationPreferencesController } from './preferences/notification-preferences.controller';
import { NotificationPreferencesService } from './preferences/notification-preferences.service';
import { PromotionSender } from './promotions/promotion-sender';
import { PromotionsController } from './promotions/promotions.controller';
import { PromotionsService } from './promotions/promotions.service';
import { SignInAlertNotifier } from './security/sign-in-alert-notifier';
import { ExpiryReminderNotifier } from './billing/expiry-reminder-notifier';

/** Firebase when its service account is configured; otherwise nothing is sent (a local run). */
function pushSenderFromEnv(): PushSender {
  try {
    return FirebasePushSender.fromEnv() ?? new DisabledPushSender();
  } catch (error) {
    new Logger('Notifications').error(
      `Firebase could not start: ${(error as Error).message}`,
    );
    return new DisabledPushSender();
  }
}

@Module({
  controllers: [
    PushDevicesController,
    NotificationPreferencesController,
    PromotionsController,
    InternalNotificationsController,
  ],
  providers: [
    { provide: PushSender, useFactory: pushSenderFromEnv },
    RevokedSessions,
    PushDevicesService,
    SessionSignOutListener,
    PushDeliveryService,
    NotificationPreferencesService,
    ChatMessageNotifier,
    SignInAlertNotifier,
    ExpiryReminderNotifier,
    CallNotifier,
    ListingAlertNotifier,
    AdminGuard,
    PromotionsService,
    PromotionSender,
  ],
})
export class NotificationsModule {}
