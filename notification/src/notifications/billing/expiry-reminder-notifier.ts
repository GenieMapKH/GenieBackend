import { Injectable } from '@nestjs/common';
import { PushDeliveryService } from '../delivery/push-delivery.service';
import { PushDevicesService } from '../devices/push-devices.service';
import { ExpiryReminderDto } from '../internal/dto/expiry-reminder.dto';

@Injectable()
export class ExpiryReminderNotifier {
  constructor(
    private readonly devices: PushDevicesService,
    private readonly delivery: PushDeliveryService,
  ) {}

  async notify(event: ExpiryReminderDto) {
    const targets = await this.devices.targetsOf(event.userId);
    return this.delivery.deliver(targets, (target) => {
      const listing = event.kind === 'listing';
      const date = new Intl.DateTimeFormat(
        target.locale === 'km' ? 'km-KH' : 'en-GB',
        { day: 'numeric', month: 'short', timeZone: 'Asia/Phnom_Penh' },
      ).format(new Date(event.expiresAt));
      return {
        channel: 'listing_alerts',
        urgent: false,
        tag: `expiry:${event.propertyId ?? 'subscription'}:${event.expiresAt}`,
        data: {
          type: 'publishing_expiry',
          kind: event.kind,
          expiresAt: event.expiresAt,
          ...(event.propertyId && { propertyId: event.propertyId }),
        },
        alert:
          target.locale === 'km'
            ? {
                title: listing
                  ? 'ការផ្សាយអចលនទ្រព្យជិតផុតកំណត់'
                  : 'គម្រោងរបស់អ្នកជិតផុតកំណត់',
                body: `ផុតកំណត់នៅថ្ងៃទី ${date}។ បន្តការបង់ប្រាក់ ដើម្បីរក្សាការផ្សាយរបស់អ្នក។`,
              }
            : {
                title: listing
                  ? 'Your property post expires soon'
                  : 'Your subscription expires soon',
                body: `Expires on ${date}. Renew to keep your listings active.`,
              },
      };
    });
  }
}
