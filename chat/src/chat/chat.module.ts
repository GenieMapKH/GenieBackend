import { MessageProtection } from './message-protection';
import { Module } from '@nestjs/common';
import { RevokedSessions, SupabaseModule } from '@tilomnov/shared';
import { BlockChecker } from './block-checker';
import { InternalBlocksController } from './internal-blocks.controller';
import { ChatAttachmentService } from './chat-attachment.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ConversationStateService } from './conversation-state.service';
import { InternalAccountsController } from './internal-accounts.controller';
import { MessageActionsController } from './message-actions.controller';
import { MessageActionsService } from './message-actions.service';
import { NotificationClient } from './notification.client';
import { PresenceService } from './presence.service';

@Module({
  imports: [SupabaseModule],
  controllers: [
    ChatController,
    MessageActionsController,
    InternalAccountsController,
    InternalBlocksController,
  ],
  providers: [
    ChatService,
    MessageProtection,
    ChatAttachmentService,
    ConversationStateService,
    MessageActionsService,
    PresenceService,
    NotificationClient,
    BlockChecker,
    RevokedSessions,
    ChatGateway,
  ],
  // Calls share the chat connection, its sign-in checks, its pushes and its
  // block checks, and list only the calls "delete for me" has not hidden.
  exports: [
    RevokedSessions,
    NotificationClient,
    ConversationStateService,
    BlockChecker,
  ],
})
export class ChatModule {}
