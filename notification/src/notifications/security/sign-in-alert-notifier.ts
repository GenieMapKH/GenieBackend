import { Injectable } from '@nestjs/common';
import {
  DeliveryReport,
  PushDeliveryService,
} from '../delivery/push-delivery.service';
import { PushDevicesService } from '../devices/push-devices.service';
import { SignInEvent, signInAlertPush } from './sign-in-alert.push';

/**
 * Warns the account's other devices that a new one signed in, as the email
 * does. Always sent: it is how an owner notices a stranger in their account.
 */
@Injectable()
export class SignInAlertNotifier {
  constructor(
    private readonly devices: PushDevicesService,
    private readonly delivery: PushDeliveryService,
  ) {}

  async notify(event: SignInEvent): Promise<DeliveryReport> {
    const targets = await this.devices.targetsOf(event.userId, {
      exceptSessionId: event.sessionId,
    });
    return this.delivery.deliver(targets, (target) =>
      signInAlertPush(event, target),
    );
  }
}
