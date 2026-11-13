import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'crypto';
import { ServiceName } from '../internal/service-token';
import { PrismaService } from '../prisma/prisma.service';
import { poolOptions } from '../prisma/pool-options';
import {
  decodeMessage,
  InvalidMessageError,
  MESSAGE_MAX_AGE_MS,
  MESSAGE_MAX_BYTES,
  MESSAGE_ROUTES,
  MessageType,
  ServiceMessage,
} from './message-contracts';
import { MessageBusyError, MessageStore } from './message-store';
import { messageContext } from './message-context';
import { RejectNullBytesPipe } from '../validation/reject-null-bytes.pipe';
import {
  deadQueueName,
  queueName,
  RabbitTransport,
  RETRY_DELAYS_MS,
  retryQueueName,
  sourceExchange,
} from './rabbit-transport';

export const MESSAGE_SERVICE = Symbol('MESSAGE_SERVICE');
export interface EnqueueOptions {
  key?: string;
  expiresAt?: Date;
  tx?: Prisma.TransactionClient;
}
type MessageHandler = (
  payload: object,
  message: ServiceMessage,
) => Promise<void>;

@Injectable()
export class MessageBus implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MessageBus.name);
  private readonly handlers = new Map<MessageType, MessageHandler>();
  private readonly store: MessageStore;
  private transport?: RabbitTransport;
  private consumer?: { channel: ConfirmChannel; tag: string };
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private polling?: Promise<void>;
  private readonly active = new Set<Promise<void>>();
  private lastWarning = 0;
  private lastCleanup = 0;
  readonly enabled: boolean;
  private readonly url: string;

  constructor(
    prisma: PrismaService,
    @Inject(MESSAGE_SERVICE) private readonly service: ServiceName,
  ) {
    this.url = process.env.RABBITMQ_URL?.trim() ?? '';
    this.enabled = this.url.length > 0;
    if (this.enabled) {
      try {
        const address = new URL(this.url);
        if (!/^amqps?:$/.test(address.protocol) || !address.hostname)
          throw new Error();
        if (
          process.env.NODE_ENV === 'production' &&
          (process.env.RABBITMQ_MANAGED_TOPOLOGY !== 'true' ||
            decodeURIComponent(address.username) !== `tilomnov_${service}`)
        )
          throw new Error('isolated');
      } catch {
        throw new Error(
          'RABBITMQ_URL must be a valid amqp or amqps URL; production requires per-service credentials and managed topology',
        );
      }
    }
    this.store = new MessageStore(prisma, service);
  }

  handle(type: MessageType, handler: MessageHandler): void {
    if (MESSAGE_ROUTES[type][1] !== this.service || this.handlers.has(type))
      throw new Error(`Invalid or duplicate handler: ${type}`);
    this.handlers.set(type, handler);
  }

  handleValidated<T extends object>(
    type: MessageType,
    metatype: Type<T>,
    handler: (payload: T) => Promise<unknown>,
  ): void {
    const validation = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    this.handle(type, async (payload) => {
      let validated: T;
      try {
        new RejectNullBytesPipe().transform(payload, { type: 'body' });
        validated = (await validation.transform(payload, {
          type: 'body',
          metatype,
        })) as T;
      } catch (error) {
        if (error instanceof BadRequestException)
          throw new InvalidMessageError('Invalid payload');
        throw error;
      }
      await handler(validated);
    });
  }

  async enqueue(
    type: MessageType,
    payload: object,
    options: EnqueueOptions = {},
  ): Promise<void> {
    if (!this.enabled) throw new Error('Messaging is not configured');
    const [source, destination] = MESSAGE_ROUTES[type];
    if (source !== this.service)
      throw new Error(`Service cannot publish ${type}`);
    const now = new Date();
    const message: ServiceMessage = {
      id: randomUUID(),
      version: 1,
      type,
      source,
      destination,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        Math.min(
          options.expiresAt?.getTime() ?? Infinity,
          now.getTime() + MESSAGE_MAX_AGE_MS,
        ),
      ).toISOString(),
      payload,
    };
    const encoded = Buffer.from(JSON.stringify(message));
    decodeMessage(encoded, destination);
    if (encoded.length > MESSAGE_MAX_BYTES)
      throw new InvalidMessageError('Message too large');
    await this.store.enqueue(message, options.key ?? null, options.tx);
  }

  onApplicationBootstrap(): Promise<void> | void {
    if (!this.enabled) return;
    // A receipt transaction holds one connection while its handler uses the pool.
    if (this.handlers.size > 0 && poolOptions().max < 2)
      throw new Error('Message consumers require DATABASE_POOL_MAX >= 2');
    for (const [type, [, destination]] of Object.entries(MESSAGE_ROUTES)) {
      if (
        destination === this.service &&
        !this.handlers.has(type as MessageType)
      )
        throw new Error(`Missing message handler: ${type}`);
    }
    return this.start();
  }

  private async start(): Promise<void> {
    await this.store.ready();
    this.transport = new RabbitTransport(
      this.url,
      async (channel) => {
        if (this.handlers.size === 0) return;
        await channel.prefetch(1);
        const { consumerTag } = await channel.consume(
          queueName(this.service),
          (delivery) => {
            if (!delivery) {
              void channel.close().catch(() => undefined);
              return;
            }
            const task = this.receive(channel, delivery);
            this.active.add(task);
            void task.finally(() => this.active.delete(task));
          },
          { noAck: false },
        );
        this.consumer = { channel, tag: consumerTag };
      },
      () => this.warn(),
      process.env.RABBITMQ_MANAGED_TOPOLOGY === 'true',
    );
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    this.polling = this.flush().finally(() => {
      if (!this.stopped) {
        this.timer = setTimeout(() => this.schedule(), 1000);
        this.timer.unref();
      }
    });
  }

  private async flush(): Promise<void> {
    try {
      if (!this.transport?.connection.isConnected()) return;
      for (let i = 0; i < 25 && !this.stopped; i++) {
        if (
          !(await this.store.dispatchOne((message) =>
            this.transport!.publish(message),
          ))
        )
          break;
      }
      if (Date.now() - this.lastCleanup > 3600000) {
        await this.store.cleanup();
        this.lastCleanup = Date.now();
      }
    } catch {
      this.warn();
    }
  }

  private async receive(
    channel: ConfirmChannel,
    delivery: ConsumeMessage,
  ): Promise<void> {
    try {
      if (this.stopped) {
        channel.nack(delivery, false, true);
        return;
      }
      let invalid = false;
      try {
        const message = decodeMessage(delivery.content, this.service);
        const exchange = delivery.fields.exchange;
        const retried =
          exchange === '' &&
          delivery.fields.routingKey === queueName(this.service) &&
          Array.isArray(delivery.properties.headers?.['x-death']) &&
          delivery.properties.headers['x-death'].some(
            (death: { queue?: string; reason?: string }) =>
              death.reason === 'expired' &&
              RETRY_DELAYS_MS.some(
                (_, index) =>
                  death.queue === retryQueueName(this.service, index),
              ),
          );
        if (exchange !== sourceExchange(message.source) && !retried)
          throw new InvalidMessageError(
            'Producer exchange does not match source',
          );
        if (Date.parse(message.expiresAt) > Date.now()) {
          const handler = this.handlers.get(message.type);
          if (!handler) throw new InvalidMessageError('Unknown handler');
          await this.store.processOnce(message, () =>
            messageContext.run(message, () =>
              handler(message.payload, message),
            ),
          );
        }
        channel.ack(delivery);
        return;
      } catch (error) {
        invalid = error instanceof InvalidMessageError;
        const busy = error instanceof MessageBusyError;
        const rawAttempt: unknown =
          delivery.properties.headers?.['x-retry-attempt'];
        const attempt =
          typeof rawAttempt === 'number' &&
          Number.isInteger(rawAttempt) &&
          rawAttempt >= 0
            ? rawAttempt
            : 0;
        const dead = invalid || (!busy && attempt >= RETRY_DELAYS_MS.length);
        const messageId: unknown = delivery.properties.messageId;
        await this.transport!.send(
          '',
          dead
            ? deadQueueName(this.service)
            : retryQueueName(this.service, busy ? 0 : attempt),
          delivery.content,
          {
            messageId: typeof messageId === 'string' ? messageId : randomUUID(),
            headers: {
              'x-retry-attempt': busy ? attempt : attempt + 1,
              ...(dead && {
                'x-failure-reason': invalid
                  ? 'invalid-message'
                  : 'retry-exhausted',
              }),
            },
          },
        );
        if (dead)
          this.logger.error(
            `Message moved to ${deadQueueName(this.service)} (${invalid ? 'invalid-message' : 'retry-exhausted'})`,
          );
        channel.ack(delivery);
      }
    } catch {
      // A failed retry publish must leave the original unacknowledged on its original channel.
      try {
        channel.nack(delivery, false, true);
      } catch {
        /* Connection loss requeues it. */
      }
      this.warn();
    }
  }

  private warn(): void {
    if (Date.now() - this.lastWarning < 30000) return;
    this.lastWarning = Date.now();
    this.logger.warn(
      'Messaging unavailable; accepted jobs remain in the database or broker for retry.',
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.consumer?.channel
      .cancel(this.consumer.tag)
      .catch(() => undefined);
    await this.polling;
    await Promise.all(this.active);
    await this.transport?.close();
  }
}
