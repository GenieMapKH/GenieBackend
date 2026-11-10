import { Module } from '@nestjs/common';
import { ListingNotificationsModule } from '../notifications/listing-notifications.module';
import { PropertiesModule } from '../properties/properties.module';
import { AccountFollowers } from './account-followers';
import { FollowerAlerts } from './follower-alerts';
import { SavedListingAlerts } from './saved-listing-alerts';

/**
 * Pushes about listings people care about: new ones from owners they
 * follow, and price drops and sales of ones they saved. Driven by the
 * listing events (`ListingChanges`); owns no data but when each was sent.
 */
@Module({
  imports: [PropertiesModule, ListingNotificationsModule],
  providers: [AccountFollowers, FollowerAlerts, SavedListingAlerts],
})
export class AlertsModule {}
