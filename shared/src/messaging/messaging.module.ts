import { DynamicModule, Global, Module } from '@nestjs/common';
import { ServiceName } from '../internal/service-token';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageBus, MESSAGE_SERVICE } from './message-bus';

@Global()
@Module({})
export class MessagingModule {
  static forService(service: ServiceName): DynamicModule {
    return {
      module: MessagingModule,
      imports: [PrismaModule],
      providers: [{ provide: MESSAGE_SERVICE, useValue: service }, MessageBus],
      exports: [MessageBus],
    };
  }
}
