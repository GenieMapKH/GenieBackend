import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { InternalFollowsController } from './internal-follows.controller';

/** Who follows whom: the counts on profiles, and whose listings fill the feed. */
@Module({
  imports: [BlocksModule],
  controllers: [FollowsController, InternalFollowsController],
  providers: [FollowsService],
})
export class FollowsModule {}
