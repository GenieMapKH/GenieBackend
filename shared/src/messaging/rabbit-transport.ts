import {
  connect,
  ChannelWrapper,
  AmqpConnectionManager,
} from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import { randomUUID } from 'crypto';
import { ServiceName } from '../internal/service-token';
import { SERVICES, ServiceMessage } from './message-contracts';

export const MESSAGE_EXCHANGE = 'tilomnov.commands.v1';
export const sourceExchange = (source: ServiceName) =>
  `${MESSAGE_EXCHANGE}.${source}`;
export const RETRY_DELAYS_MS = [5000, 30000, 120000];
export const queueName = (service: ServiceName) => `tilomnov.${service}.v1`;
export const deadQueueName = (service: ServiceName) =>
  `${queueName(service)}.dead`;
export const retryQueueName = (service: ServiceName, attempt: number) =>
  `${queueName(service)}.retry.${attempt}`;

export async function setupMessageTopology(
  channel: ConfirmChannel,
): Promise<void> {
  for (const source of SERVICES)
    await channel.assertExchange(sourceExchange(source), 'direct', {
      durable: true,
    });
  for (const service of SERVICES) {
    const queue = queueName(service);
    await channel.assertQueue(deadQueueName(service), {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
        'x-delivery-limit': 50,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': deadQueueName(service),
        'x-dead-letter-strategy': 'at-least-once',
        'x-overflow': 'reject-publish',
      },
    });
    for (const source of SERVICES)
      await channel.bindQueue(queue, sourceExchange(source), service);
    for (let index = 0; index < RETRY_DELAYS_MS.length; index++) {
      await channel.assertQueue(retryQueueName(service, index), {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-message-ttl': RETRY_DELAYS_MS[index],
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': queue,
          'x-dead-letter-strategy': 'at-least-once',
          'x-overflow': 'reject-publish',
        },
      });
    }
  }
}

/** One confirmed channel per process; reconnect setup restores topology and its consumer. */
export class RabbitTransport {
  readonly connection: AmqpConnectionManager;
  readonly channel: ChannelWrapper;
  private readonly returned = new Map<string, boolean>();
  private closed = false;

  constructor(
    url: string,
    setupConsumer: (channel: ConfirmChannel) => Promise<void>,
    onError: () => void,
    managedTopology = false,
  ) {
    this.connection = connect([url], {
      heartbeatIntervalInSeconds: 10,
      reconnectTimeInSeconds: 5,
      connectionOptions: { timeout: 5000 },
    });
    this.connection.on('disconnect', onError);
    this.connection.on('connectFailed', onError);
    this.channel = this.connection.createChannel({
      confirm: true,
      publishTimeout: 5000,
      setup: async (channel: ConfirmChannel) => {
        channel.on('error', onError);
        channel.once('close', () => {
          // Let a closing connection emit its own close event before forcing channel-only recovery.
          setImmediate(() => {
            if (!this.closed && this.connection.isConnected())
              this.connection.reconnect();
          });
        });
        channel.on('return', (message: ConsumeMessage) => {
          const id: unknown = message.properties.correlationId;
          if (typeof id === 'string' && this.returned.has(id))
            this.returned.set(id, true);
        });
        if (!managedTopology) await setupMessageTopology(channel);
        await setupConsumer(channel);
      },
    });
    this.channel.on('error', onError);
  }

  publish(message: ServiceMessage): Promise<void> {
    return this.send(
      sourceExchange(message.source),
      message.destination,
      Buffer.from(JSON.stringify(message)),
      { messageId: message.id },
    );
  }

  async send(
    exchange: string,
    routingKey: string,
    body: Buffer,
    options: Options.Publish,
  ): Promise<void> {
    const id = randomUUID();
    this.returned.set(id, false);
    try {
      await this.channel.publish(exchange, routingKey, body, {
        ...options,
        correlationId: id,
        persistent: true,
        mandatory: true,
        contentType: 'application/json',
      });
      if (this.returned.get(id)) throw new Error('Unroutable message');
    } finally {
      this.returned.delete(id);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}
