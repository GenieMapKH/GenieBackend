import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FEED_SPREAD_HOURS, readFeedSpreadHours } from './feed-spread';
import { FollowedAccounts } from './followed-accounts';

/** The Feed tab: listings of the people a user follows. */
@Module({
  controllers: [FeedController],
  providers: [
    FeedService,
    { provide: FEED_SPREAD_HOURS, useFactory: () => readFeedSpreadHours() },
    {
      provide: FollowedAccounts,
      useFactory: () =>
        new FollowedAccounts(
          process.env.USER_SERVICE_URL || 'http://localhost:4002',
        ),
    },
  ],
})
export class FeedModule {}
