import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CallHistoryService } from './call-history.service';
import { CallStore, RedisCallStore } from './call.store';
import { CallsController } from './calls.controller';
import { CallsGateway } from './calls.gateway';
import { CallsService } from './calls.service';
import { IceServersService } from './ice-servers.service';

/** One-to-one voice calls, signalled over the chat connection. */
@Module({
  imports: [ChatModule],
  controllers: [CallsController],
  providers: [
    { provide: CallStore, useClass: RedisCallStore },
    {
      provide: IceServersService,
      useFactory: () => new IceServersService(process.env),
    },
    CallHistoryService,
    CallsService,
    CallsGateway,
  ],
})
export class CallsModule {}
