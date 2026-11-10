import { Injectable } from '@nestjs/common';
import {
  DeliveryReport,
  PushDeliveryService,
} from '../delivery/push-delivery.service';
import { PushDevicesService } from '../devices/push-devices.service';
import {
  CallEndedEvent,
  CallEvent,
  callEndedPush,
  incomingCallPush,
} from './call.push';

/**
 * Rings the callee's devices that are not connected to chat (a closed or
 * background app), and stops them ringing when the call ends. Calls are
 * not optional: a call nobody hears is not a call.
 */
@Injectable()
export class CallNotifier {
  constructor(
    private readonly devices: PushDevicesService,
    private readonly delivery: PushDeliveryService,
  ) {}

  async ringing(event: CallEvent): Promise<DeliveryReport> {
    const targets = await this.devices.targetsOf(event.calleeId);
    return this.delivery.deliver(targets, (target) =>
      incomingCallPush(event, target),
    );
  }

  async ended(event: CallEndedEvent): Promise<DeliveryReport> {
    const targets = await this.devices.targetsOf(event.calleeId);
    return this.delivery.deliver(targets, (target) =>
      callEndedPush(event, target),
    );
  }
}
