import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryReport,
  PushDeliveryService,
} from '../delivery/push-delivery.service';
import { PushContent, PushTarget } from '../delivery/push-sender';
import { PushDevicesService } from '../devices/push-devices.service';
import { SwitchablePreference } from '../preferences/notification-preferences.service';

/** One person to tell about a listing, and how their push reads. */
export interface ListingAlertRecipient {
  userId: string;
  push: (target: PushTarget) => PushContent;
}

/**
 * Tells several people about a listing at once (a saved search matched, a
 * person they follow posted, a price dropped), each on every device, unless
 * they turned [preference] off. Devices are read in one query and pushed in
 * the provider's batches.
 */
@Injectable()
export class ListingAlertNotifier {
  private readonly logger = new Logger(ListingAlertNotifier.name);

  constructor(
    private readonly devices: PushDevicesService,
    private readonly delivery: PushDeliveryService,
  ) {}

  async notify(
    kind: string,
    preference: SwitchablePreference,
    recipients: ListingAlertRecipient[],
  ): Promise<DeliveryReport> {
    const byUser = await this.devices.targetsByUser(
      recipients.map((recipient) => recipient.userId),
      preference,
    );
    const pushOf = new Map<string, ListingAlertRecipient['push']>();
    const targets: PushTarget[] = [];
    for (const recipient of recipients) {
      for (const target of byUser.get(recipient.userId) ?? []) {
        pushOf.set(target.id, recipient.push);
        targets.push(target);
      }
    }

    const report = await this.delivery.deliver(targets, (target) =>
      pushOf.get(target.id)!(target),
    );
    this.logger.log(
      `${kind} push: ${recipients.length} people, ${targets.length} device(s), sent ${report.sent}, failed ${report.failed}, removed ${report.removed}`,
    );
    return report;
  }
}
