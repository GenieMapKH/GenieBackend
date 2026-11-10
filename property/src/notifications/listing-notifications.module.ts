import { Module } from '@nestjs/common';
import { ListingNotificationsClient } from './listing-notifications.client';

/** How the property service asks for pushes about listings. */
@Module({
  providers: [ListingNotificationsClient],
  exports: [ListingNotificationsClient],
})
export class ListingNotificationsModule {}
