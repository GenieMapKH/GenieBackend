import { Module } from '@nestjs/common';
import { MessageBus, SupabaseModule } from '@tilomnov/shared';
import { AccountContentService } from './account-content.service';
import { AvatarService } from './avatar.service';
import { InternalAccountsController } from './internal-accounts.controller';
import {
  CHAT_CONTENT,
  PROPERTY_CONTENT,
  RemoteAccountContent,
} from './remote-account-content';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * The profile, the profile picture, and what happens to an account's content
 * when it is hidden or erased. The services that hold that content (listings,
 * chat) are reached over their internal routes; this module imports none of
 * their code.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [UsersController, InternalAccountsController],
  providers: [
    UsersService,
    AvatarService,
    AccountContentService,
    {
      provide: PROPERTY_CONTENT,
      inject: [MessageBus],
      useFactory: (messages: MessageBus) =>
        new RemoteAccountContent(
          'property',
          process.env.PROPERTY_SERVICE_URL || 'http://localhost:4003',
          messages,
        ),
    },
    {
      provide: CHAT_CONTENT,
      useFactory: () =>
        new RemoteAccountContent(
          'chat',
          process.env.CHAT_SERVICE_URL || 'http://localhost:4004',
        ),
    },
  ],
})
export class UsersModule {}
