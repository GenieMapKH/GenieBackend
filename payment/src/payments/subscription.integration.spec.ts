import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@tilomnov/prisma-client';
import { ServiceClient } from '@tilomnov/shared';
import { SubscriptionService } from './subscription.service';
import { PublishingAllowanceService } from '../../../property/src/properties/services/publishing-allowance.service';
import { PropertyLifecycleService } from '../../../property/src/properties/services/property-lifecycle.service';
import { PropertyStatusService } from '../../../property/src/properties/property-status.service';

// Opt in only against a disposable local DB with baseline + migrations 35–37.
const databaseTests = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseTests('persisted subscriptions and publishing (Postgres)', () => {
  const alice = randomUUID();
  const bob = randomUUID();
  let owner: Pool;
  let payment: PrismaClient;
  let property: PrismaClient;
  let subscriptions: SubscriptionService;
  let lifecycle: PropertyLifecycleService;
  let call: jest.SpyInstance;
  const input = {
    title: 'Integration test',
    price: 100,
    propertyType: 'Land',
    status: 'Active',
  };

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('Disposable local DB required');
    owner = new Pool({ connectionString: url.toString() });
    await owner.query(
      "ALTER ROLE payment_service PASSWORD 'local-payment-test'; ALTER ROLE property_service PASSWORD 'local-payment-test'",
    );
    await owner.query(
      'INSERT INTO account.users(id, password_hash, email) VALUES ($1, $3, $4), ($2, $3, $5)',
      [alice, bob, 'test-only', `${alice}@test.invalid`, `${bob}@test.invalid`],
    );
    function client(role: string) {
      const roleUrl = new URL(url);
      roleUrl.username = role;
      roleUrl.password = 'local-payment-test';
      return new PrismaClient({
        adapter: new PrismaPg(
          new Pool({ connectionString: roleUrl.toString(), max: 4 }),
          { disposeExternalPool: true },
        ),
      });
    }
    payment = client('payment_service');
    property = client('property_service');
    await Promise.all([payment.$connect(), property.$connect()]);
    process.env.PAYMENT_MODE = 'mock';
    process.env.APP_ENV = 'test';
    subscriptions = new SubscriptionService(payment as never);
    call = jest
      .spyOn(ServiceClient.prototype, 'call')
      .mockImplementation(async (_method, path) => {
        const userId = path.split('/')[3];
        return subscriptions.allowance(userId);
      });
    const allowance = new PublishingAllowanceService(property as never);
    lifecycle = new PropertyLifecycleService(
      property as never,
      {
        findOwned: (userId: string, id: string) =>
          property.property.findFirstOrThrow({ where: { id, userId } }),
      } as never,
      new PropertyStatusService(),
      { changed: async () => {}, wentLive: async () => {} } as never,
      {} as never,
      {} as never,
      allowance,
    );
  });

  afterAll(async () => {
    call?.mockRestore();
    await owner?.query('DELETE FROM account.users WHERE id IN ($1, $2)', [
      alice,
      bob,
    ]);
    await Promise.all([payment?.$disconnect(), property?.$disconnect()]);
    await owner?.end();
  });

  it('permits only one of two concurrent first free listings', async () => {
    const results = await Promise.allSettled([
      lifecycle.create(alice, input),
      lifecycle.create(alice, input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(refused.reason.getStatus()).toBe(402);
    expect(
      await property.property.count({
        where: { userId: alice, status: 'Active' },
      }),
    ).toBe(1);
  });

  it('cannot bypass the limit by publishing or relisting a saved listing', async () => {
    const draft = await lifecycle.create(alice, { ...input, status: 'Draft' });
    await expect(lifecycle.publish(alice, draft.id)).rejects.toMatchObject({
      status: 402,
    });
    await property.property.update({
      where: { id: draft.id },
      data: { status: 'Sold' },
    });
    await expect(lifecycle.relist(alice, draft.id)).rejects.toMatchObject({
      status: 402,
    });
  });

  it('saves a purchase once under concurrent retries and reads it from a fresh service', async () => {
    const requestId = randomUUID();
    const [first, repeat] = await Promise.all([
      subscriptions.purchase(alice, 'gold', requestId),
      subscriptions.purchase(alice, 'gold', requestId),
    ]);
    expect(first.transactionId).toBe(repeat.transactionId);
    const fresh = new SubscriptionService(payment as never);
    const saved = await fresh.current(alice);
    expect(saved?.tier).toBe('gold');
    expect(saved?.currentPeriodEnd.getUTCDate()).toBe(
      saved?.currentPeriodStart.getUTCDate(),
    );
    expect(await fresh.current(bob)).toBeNull();
    expect(
      await payment.paymentTransaction.count({ where: { userId: alice } }),
    ).toBe(1);
    await expect(lifecycle.create(alice, input)).resolves.toMatchObject({
      status: 'Active',
    });
  });

  it('cancels renewal durably while retaining the same tier and exact end timestamp', async () => {
    const before = await subscriptions.current(alice);
    await Promise.all([
      subscriptions.cancel(alice),
      subscriptions.cancel(alice),
    ]);
    const after = await new SubscriptionService(payment as never).current(
      alice,
    );
    expect(after?.cancelAtPeriodEnd).toBe(true);
    expect(after?.tier).toBe(before?.tier);
    expect(after?.currentPeriodEnd).toEqual(before?.currentPeriodEnd);
    expect(await subscriptions.current(bob)).toBeNull();
  });

  it('revokes the paid allowance at expiry and when mock payments are disabled', async () => {
    process.env.PAYMENT_MODE = 'disabled';
    expect(await subscriptions.current(alice)).toBeNull();
    process.env.PAYMENT_MODE = 'mock';
    const expired = new Date(Date.now() - 1000);
    await payment.subscription.update({
      where: { userId: alice },
      data: {
        currentPeriodStart: new Date(expired.getTime() - 86400000),
        currentPeriodEnd: expired,
      },
    });
    expect(await subscriptions.current(alice)).toBeNull();
    await expect(lifecycle.create(alice, input)).rejects.toMatchObject({
      status: 402,
    });
  });

  it('rolls back the transaction if saving the subscription fails', async () => {
    await owner.query(`CREATE FUNCTION payment.reject_test_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'write failed'; END $$;
      CREATE TRIGGER reject_test_subscription BEFORE INSERT ON payment.subscriptions
      FOR EACH ROW EXECUTE FUNCTION payment.reject_test_subscription()`);
    try {
      await expect(
        subscriptions.purchase(bob, 'silver', randomUUID()),
      ).rejects.toThrow('write failed');
      expect(
        await payment.paymentTransaction.count({ where: { userId: bob } }),
      ).toBe(0);
    } finally {
      await owner.query(
        'DROP TRIGGER reject_test_subscription ON payment.subscriptions; DROP FUNCTION payment.reject_test_subscription()',
      );
    }
  });
});
