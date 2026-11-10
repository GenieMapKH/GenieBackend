import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryReport,
  PushDeliveryService,
} from '../delivery/push-delivery.service';
import { PushDevicesService } from '../devices/push-devices.service';
import { NotificationPreferencesService } from '../preferences/notification-preferences.service';
import { ChatMessageEvent, chatMessagePush } from './chat-message.push';

const NOTHING_SENT: DeliveryReport = { sent: 0, failed: 0, removed: 0 };

/**
 * Tells someone they have a new chat message, on every device they are
 * signed in on, unless they turned chat notifications off. The app hides it
 * while that very conversation is open on screen. Every outcome is logged,
 * so "no notification arrived" can be traced to its cause.
 */
@Injectable()
export class ChatMessageNotifier {
  private readonly logger = new Logger(ChatMessageNotifier.name);

  constructor(
    private readonly preferences: NotificationPreferencesService,
    private readonly devices: PushDevicesService,
    private readonly delivery: PushDeliveryService,
  ) {}

  async notify(event: ChatMessageEvent): Promise<DeliveryReport> {
    if (event.recipientId === event.senderId) return NOTHING_SENT;
    if (!(await this.preferences.get(event.recipientId)).chatMessages) {
      this.logger.log(
        `Chat push for ${event.recipientId} skipped: chat notifications are turned off`,
      );
      return NOTHING_SENT;
    }

    const targets = await this.devices.targetsOf(event.recipientId);
    if (targets.length === 0) {
      this.logger.warn(
        `Chat push for ${event.recipientId} not sent: no device is registered for this account`,
      );
      return NOTHING_SENT;
    }

    const report = await this.delivery.deliver(targets, (target) =>
      chatMessagePush(event, target),
    );
    this.logger.log(
      `Chat push for ${event.recipientId}: ${targets.length} device(s), sent ${report.sent}, failed ${report.failed}, removed ${report.removed}`,
    );
    return report;
  }
}
