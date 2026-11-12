import { MessagingModule } from '@tilomnov/shared';
import { Module } from '@nestjs/common';
import { HealthController, PrismaModule, RedisModule } from '@tilomnov/shared';
import { CallsModule } from './calls/calls.module';
import { ChatModule } from './chat/chat.module';
import { SentryErrorsModule } from '@tilomnov/shared/sentry';

/** The chat service: messages over REST and WebSocket, presence, key backups, attachments and calls. */
@Module({
  imports: [
    MessagingModule.forService('chat'),
    SentryErrorsModule,
    RedisModule,
    PrismaModule,
    ChatModule,
    CallsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
