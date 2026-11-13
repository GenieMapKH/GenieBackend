import { randomUUID } from 'crypto';
import { IsUUID } from 'class-validator';
import { MessageBus } from './message-bus';
import {
  decodeMessage,
  InvalidMessageError,
  MESSAGE_MAX_BYTES,
  MESSAGE_ROUTES,
  ServiceMessage,
} from './message-contracts';
import { MessageStore } from './message-store';
import {
  deadQueueName,
  RETRY_DELAYS_MS,
  retryQueueName,
  sourceExchange,
} from './rabbit-transport';

class Payload {
  @IsUUID() userId: string;
}
const envelope = (patch: Partial<ServiceMessage> = {}): ServiceMessage => ({
  id: randomUUID(),
  version: 1,
  type: 'notification.sign-in.v1',
  source: 'authentication',
  destination: 'notification',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  payload: { userId: randomUUID() },
  ...patch,
});

describe('message contracts', () => {
  it('accepts a versioned message for its intended service', () => {
    const message = envelope();
    expect(
      decodeMessage(Buffer.from(JSON.stringify(message)), 'notification'),
    ).toEqual(message);
  });
  it.each([
    { version: 2 },
    { id: 'invalid' },
    { source: 'user' },
    { destination: 'chat' },
    { type: 'unknown' },
    { type: '__proto__' },
    { payload: null },
    { payload: [] },
    { expiresAt: 'invalid' },
    { createdAt: 'invalid' },
    { expiresAt: new Date(0).toISOString() },
    { expiresAt: new Date(Date.now() + 8 * 86400000).toISOString() },
    { createdAt: new Date(Date.now() + 120000).toISOString() },
  ])('rejects an invalid envelope: %j', (patch) => {
    expect(() =>
      decodeMessage(
        Buffer.from(JSON.stringify(envelope(patch as never))),
        'notification',
      ),
    ).toThrow(InvalidMessageError);
  });
  it.each(['null', '[]', 'false', 'invalid'])(
    'rejects non-envelopes %s',
    (body) => {
      expect(() => decodeMessage(Buffer.from(body), 'notification')).toThrow(
        InvalidMessageError,
      );
    },
  );
  it('bounds message size before parsing', () => {
    expect(() =>
      decodeMessage(Buffer.alloc(MESSAGE_MAX_BYTES + 1), 'notification'),
    ).toThrow(InvalidMessageError);
  });
});

describe('message delivery', () => {
  const originalUrl = process.env.RABBITMQ_URL;
  let bus: MessageBus;
  let store: { enqueue: jest.Mock; processOnce: jest.Mock };
  let transport: { send: jest.Mock };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  beforeEach(() => {
    process.env.RABBITMQ_URL = 'amqp://localhost';
    bus = new MessageBus({} as never, 'notification');
    store = {
      enqueue: jest.fn(),
      processOnce: jest.fn(async (_message, handle) => handle()),
    };
    transport = { send: jest.fn().mockResolvedValue(undefined) };
    channel = { ack: jest.fn(), nack: jest.fn() };
    Object.assign(bus, { store, transport });
  });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.RABBITMQ_URL;
    else process.env.RABBITMQ_URL = originalUrl;
  });
  const receive = (instance: MessageBus, delivery: unknown) =>
    (instance as any).receive(channel, delivery);
  const delivery = (message = envelope(), headers = {}) => ({
    fields: {
      exchange: sourceExchange(message.source),
      routingKey: message.destination,
    },
    content: Buffer.from(JSON.stringify(message)),
    properties: { messageId: message.id, headers },
  });

  it('keeps HTTP mode inert when no broker is configured', async () => {
    delete process.env.RABBITMQ_URL;
    const disabled = new MessageBus({} as never, 'chat');
    expect(disabled.enabled).toBe(false);
    await disabled.onApplicationBootstrap();
    await expect(
      disabled.enqueue('notification.chat-message.v1', {}),
    ).rejects.toThrow('not configured');
    await disabled.onModuleDestroy();
  });
  it('refuses shared bootstrap broker identity in production', () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      RABBITMQ_MANAGED_TOPOLOGY: process.env.RABBITMQ_MANAGED_TOPOLOGY,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.RABBITMQ_URL = 'amqp://shared:fixture-password@localhost';
      process.env.RABBITMQ_MANAGED_TOPOLOGY = 'true';
      expect(() => new MessageBus({} as never, 'chat')).toThrow(
        'per-service credentials',
      );
      process.env.RABBITMQ_URL =
        'amqp://tilomnov_chat:fixture-password@localhost';
      expect(() => new MessageBus({} as never, 'chat')).not.toThrow();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  it.each([
    'https://private:password@example.com',
    'amqp:missing-host',
    'invalid',
  ])(
    'rejects invalid configuration without exposing credentials: %s',
    (url) => {
      process.env.RABBITMQ_URL = url;
      expect(() => new MessageBus({} as never, 'chat')).toThrow(
        'valid amqp or amqps URL',
      );
    },
  );

  it('rejects a consumer pool that would deadlock its handler', () => {
    const saved = process.env.DATABASE_POOL_MAX;
    try {
      process.env.DATABASE_POOL_MAX = '1';
      bus.handle('notification.sign-in.v1', jest.fn());
      expect(() => bus.onApplicationBootstrap()).toThrow(
        'DATABASE_POOL_MAX >= 2',
      );
    } finally {
      if (saved === undefined) delete process.env.DATABASE_POOL_MAX;
      else process.env.DATABASE_POOL_MAX = saved;
    }
  });
  it('checks producer and consumer ownership and duplicate registrations', async () => {
    await expect(bus.enqueue('notification.sign-in.v1', {})).rejects.toThrow(
      'cannot publish',
    );
    expect(() => bus.handle('chat.user-blocked.v1', jest.fn())).toThrow();
    bus.handle('notification.sign-in.v1', jest.fn());
    expect(() => bus.handle('notification.sign-in.v1', jest.fn())).toThrow();
  });
  it('persists before publishing and passes the business transaction through', async () => {
    const producer = new MessageBus({} as never, 'chat');
    Object.assign(producer, { store });
    const tx = {} as never;
    await producer.enqueue(
      'notification.chat-message.v1',
      { messageId: randomUUID() },
      { key: 'chat:one', tx },
    );
    expect(store.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat',
        destination: 'notification',
        version: 1,
      }),
      'chat:one',
      tx,
    );
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('rejects expired outgoing work and oversized payloads', async () => {
    const producer = new MessageBus({} as never, 'chat');
    await expect(
      producer.enqueue(
        'notification.chat-message.v1',
        {},
        { expiresAt: new Date(0) },
      ),
    ).rejects.toThrow(InvalidMessageError);
    await expect(
      producer.enqueue('notification.chat-message.v1', {
        text: 'x'.repeat(MESSAGE_MAX_BYTES),
      }),
    ).rejects.toThrow(InvalidMessageError);
  });
  it('acknowledges only after its handler and receipt complete', async () => {
    const handle = jest.fn(async () => {
      expect(channel.ack).not.toHaveBeenCalled();
    });
    bus.handle('notification.sign-in.v1', handle);
    const job = delivery();
    await receive(bus, job);
    expect(handle).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(job);
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('drops expired work without calling its handler', async () => {
    const handle = jest.fn();
    bus.handle('notification.sign-in.v1', handle);
    await receive(
      bus,
      delivery(
        envelope({
          createdAt: new Date(Date.now() - 120000).toISOString(),
          expiresAt: new Date(Date.now() - 60000).toISOString(),
        }),
      ),
    );
    expect(handle).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalled();
  });
  it.each([0, 1, 2])(
    'uses retry queue %i after a transient failure',
    async (attempt) => {
      bus.handle('notification.sign-in.v1', () =>
        Promise.reject(new Error('temporary')),
      );
      const job = delivery(envelope(), { 'x-retry-attempt': attempt });
      await receive(bus, job);
      expect(transport.send).toHaveBeenCalledWith(
        '',
        retryQueueName('notification', attempt),
        job.content,
        expect.objectContaining({
          headers: { 'x-retry-attempt': attempt + 1 },
        }),
      );
      expect(channel.ack).toHaveBeenCalled();
    },
  );
  it('dead-letters exhausted work with the payload preserved', async () => {
    bus.handle('notification.sign-in.v1', () =>
      Promise.reject(new Error('temporary')),
    );
    const job = delivery(envelope(), {
      'x-retry-attempt': RETRY_DELAYS_MS.length,
    });
    await receive(bus, job);
    expect(transport.send).toHaveBeenCalledWith(
      '',
      deadQueueName('notification'),
      job.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-failure-reason': 'retry-exhausted',
        }),
      }),
    );
    expect(channel.ack).toHaveBeenCalled();
  });
  it('does not acknowledge the original when forwarding to retry fails', async () => {
    bus.handle('notification.sign-in.v1', () =>
      Promise.reject(new Error('temporary')),
    );
    transport.send.mockRejectedValue(new Error('offline'));
    const job = delivery();
    await receive(bus, job);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(job, false, true);
  });
  it.each([
    { userId: 'invalid' },
    { userId: randomUUID(), injected: 'extra' },
    { userId: 'bad\u0000text' },
  ])('dead-letters invalid DTOs without side effects: %j', async (payload) => {
    const handler = jest.fn();
    bus.handleValidated('notification.sign-in.v1', Payload, handler);
    await receive(bus, delivery(envelope({ payload })));
    expect(handler).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith(
      '',
      deadQueueName('notification'),
      expect.any(Buffer),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-failure-reason': 'invalid-message',
        }),
      }),
    );
  });
  it('requires a receiver for every declared route at bootstrap', () => {
    expect(() => bus.onApplicationBootstrap()).toThrow(
      'Missing message handler',
    );
    expect(Object.keys(MESSAGE_ROUTES).length).toBeGreaterThan(0);
  });
});

describe('outbox failure recovery', () => {
  it('keeps failed publications pending with a bounded backoff', async () => {
    const execute = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: randomUUID(),
          envelope: envelope(),
          attempts: 100,
          expired: false,
        },
      ]),
      $executeRaw: execute,
    };
    const store = new MessageStore(
      { $transaction: (run: any) => run(tx) } as never,
      'chat',
    );
    expect(
      await store.dispatchOne(() => Promise.reject(new Error('offline'))),
    ).toBe(false);
    expect(execute.mock.calls[0]).toContain(60);
  });
});
