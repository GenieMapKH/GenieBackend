import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@tilomnov/prisma-client';
import { MessageBus, ServiceClient } from '@tilomnov/shared';
import { OrderEmailClient } from './order-email.client';
import { ListingChanges } from '../../../property/src/properties/services/listing-changes.service';
import { SubscriptionService } from './subscription.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { PublishingAllowanceService } from '../../../property/src/properties/services/publishing-allowance.service';
import { PropertyLifecycleService } from '../../../property/src/properties/services/property-lifecycle.service';
import { PropertyStatusService } from '../../../property/src/properties/property-status.service';
import { ExpiredPublishingService } from '../../../property/src/properties/services/expired-publishing.service';
import { PropertyPublicationService } from '../../../property/src/properties/services/property-publication.service';
import { PaymentCheckoutService } from './payment-checkout.service';
import { AdminIncomeService } from './admin-income.service';

// Opt in only against a disposable local DB with baseline + all later migrations.
const databaseTests = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseTests.each([false, true])(
  'persisted subscriptions and publishing (Postgres, queued=%s)',
  persistedServiceFlows,
);

function persistedServiceFlows(queued: boolean) {
  const alice = randomUUID();
  const bob = randomUUID();
  let owner: Pool;
  let payment: PrismaClient;
  let property: PrismaClient;
  let subscriptions: SubscriptionService;
  let gateway: PaymentGatewayService;
  const provider = new MockPaymentProvider();
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const originalRabbitUrl = process.env.RABBITMQ_URL;
  let lifecycle: PropertyLifecycleService;
  let allowance: PublishingAllowanceService;
  let checkout: PaymentCheckoutService;
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
      "INSERT INTO account.users(id, password_hash, email, phone) VALUES ($1, $3, $4, '+85512345678'), ($2, $3, $5, '+85512999999')",
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
    process.env.INTERNAL_SERVICE_SECRET =
      'integration-test-payment-secret-32-characters';
    if (queued)
      process.env.RABBITMQ_URL =
        'amqp://messaging_test:messaging_test@127.0.0.1:5679/tilomnov-test';
    const query = {
      findOwned: (userId: string, id: string) =>
        property.property.findFirstOrThrow({ where: { id, userId } }),
    };
    const changes = queued
      ? new ListingChanges(
          { changed: async () => {} } as never,
          new MessageBus(property as never, 'property'),
        )
      : { changed: async () => {}, wentLive: async () => {} };
    if (queued) {
      const client = new OrderEmailClient(
        new MessageBus(payment as never, 'payment'),
      );
      Object.assign(email, { queued: true });
      email.send.mockImplementation((details, tx) => client.send(details, tx));
    }
    const publication = new PropertyPublicationService(
      property as never,
      query as never,
      new PropertyStatusService(),
      changes as never,
      new PublishingAllowanceService(property as never),
    );
    const publishing = {
      begin: (userId: string, id: string) =>
        publication.beginPublish(userId, id),
      settle: (id: string, outcome: 'Active' | 'Draft') =>
        publication.settlePublish(id, outcome),
      revert: (id: string, status: string) =>
        publication.revertPublish(id, status),
    };
    gateway = new PaymentGatewayService(
      payment as never,
      provider,
      publishing as never,
      email as never,
    );
    subscriptions = new SubscriptionService(
      payment as never,
      gateway,
      provider,
    );
    checkout = new PaymentCheckoutService(
      payment as never,
      publishing as never,
      gateway,
      provider,
    );
    call = jest
      .spyOn(ServiceClient.prototype, 'call')
      .mockImplementation(async (_method, path) => {
        const userId = path.split('/')[3];
        return path.endsWith('/publishing')
          ? subscriptions.publishingEntitlements(userId)
          : subscriptions.allowance(userId);
      });
    allowance = new PublishingAllowanceService(property as never);
    lifecycle = new PropertyLifecycleService(
      property as never,
      query as never,
      new PropertyStatusService(),
      changes as never,
      {} as never,
      {} as never,
      allowance,
    );
  });

  afterAll(async () => {
    if (originalRabbitUrl === undefined) delete process.env.RABBITMQ_URL;
    else process.env.RABBITMQ_URL = originalRabbitUrl;
    call?.mockRestore();
    await owner?.query(
      'DELETE FROM payment.subscriptions WHERE user_id IN ($1, $2)',
      [alice, bob],
    );
    await owner?.query(
      'DELETE FROM payment.payment_transactions WHERE user_id IN ($1, $2)',
      [alice, bob],
    );
    await owner?.query('DELETE FROM account.users WHERE id IN ($1, $2)', [
      alice,
      bob,
    ]);
    await Promise.all([payment?.$disconnect(), property?.$disconnect()]);
    await owner?.end();
  });

  if (queued)
    it('rolls back paid publication when its outbox fails and recovers on reconciliation', async () => {
      const userId = randomUUID();
      await owner.query(
        "INSERT INTO account.users(id,password_hash,email,phone) VALUES($1,'test-only',$2,'+855887650001')",
        [userId, `${userId}@test.invalid`],
      );
      let transactionId: string | undefined;
      try {
        await lifecycle.create(userId, input);
        const target = await lifecycle.create(userId, {
          ...input,
          status: 'Draft',
        });
        await owner.query(
          "CREATE FUNCTION listing.reject_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test outbox failure'; END $$; CREATE TRIGGER reject_test_outbox BEFORE INSERT ON listing.service_outbox FOR EACH ROW EXECUTE FUNCTION listing.reject_test_outbox()",
        );
        await expect(
          checkout.initiate(userId, target.id, randomUUID()),
        ).rejects.toThrow();
        const pending = await payment.paymentTransaction.findFirstOrThrow({
          where: { userId, propertyId: target.id },
        });
        transactionId = pending.id;
        expect(pending.status).toBe('Pending');
        expect(
          (
            await property.property.findUniqueOrThrow({
              where: { id: target.id },
            })
          ).status,
        ).toBe('Pending');
        await owner.query(
          'DROP TRIGGER reject_test_outbox ON listing.service_outbox; DROP FUNCTION listing.reject_test_outbox()',
        );
        await expect(gateway.reconcile(pending.id)).resolves.toMatchObject({
          status: 'Success',
        });
        expect(
          (
            await property.property.findUniqueOrThrow({
              where: { id: target.id },
            })
          ).status,
        ).toBe('Active');
        const mail = await payment.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) AS count FROM payment.service_outbox WHERE dedup_key = ${`order:${pending.id}`}`;
        expect(Number(mail[0].count)).toBe(1);
      } finally {
        await owner.query(
          'DROP TRIGGER IF EXISTS reject_test_outbox ON listing.service_outbox; DROP FUNCTION IF EXISTS listing.reject_test_outbox()',
        );
        if (transactionId)
          await payment.paymentTransaction.deleteMany({
            where: { id: transactionId },
          });
        await owner.query('DELETE FROM account.users WHERE id=$1', [userId]);
      }
    });

  it('persists a full annual purchase and its capacity after verified payment', async () => {
    const userId = randomUUID();
    await owner.query(
      "INSERT INTO account.users(id, password_hash, email, phone) VALUES ($1, 'test-only', $2, '+855887654321')",
      [userId, `${userId}@test.invalid`],
    );
    try {
      const quote = await subscriptions.quote(userId, 'silver', 'annual');
      expect(quote.amount).toBe(70);
      const checkout = await subscriptions.purchase(
        userId,
        'silver',
        randomUUID(),
        'aba_pay',
        quote.quote,
      );
      await gateway.reconcile(checkout.transactionId);
      const saved = await subscriptions.current(userId);
      expect(saved).toMatchObject({
        tier: 'silver',
        billingPeriod: 'annual',
        listingLimit: 10,
      });
      expect(Number(saved!.periodAmount)).toBe(70);
      const expected = new Date(saved!.currentPeriodStart);
      expected.setUTCFullYear(expected.getUTCFullYear() + 1);
      expect(saved!.currentPeriodEnd).toEqual(expected);
      expect((await subscriptions.allowance(userId)).listingLimit).toBe(10);
    } finally {
      await owner.query('DELETE FROM payment.subscriptions WHERE user_id=$1', [
        userId,
      ]);
      await owner.query(
        'DELETE FROM payment.payment_transactions WHERE user_id=$1',
        [userId],
      );
      await owner.query('DELETE FROM account.users WHERE id=$1', [userId]);
    }
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
    const draft = await lifecycle.create(alice, {
      ...input,
      status: 'Draft',
    });
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
    email.send.mockClear();
    const requestId = randomUUID();
    const [first, repeat] = await Promise.all([
      subscriptions.purchase(alice, 'gold', requestId),
      subscriptions.purchase(alice, 'gold', requestId),
    ]);
    expect(first.transactionId).toBe(repeat.transactionId);
    expect(email.send).toHaveBeenCalledTimes(1);
    const fresh = new SubscriptionService(payment as never, gateway, provider);
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
    const after = await new SubscriptionService(
      payment as never,
      gateway,
      provider,
    ).current(alice);
    expect(after?.cancelAtPeriodEnd).toBe(true);
    expect(after?.tier).toBe(before?.tier);
    expect(after?.currentPeriodEnd).toEqual(before?.currentPeriodEnd);
    expect(await subscriptions.current(bob)).toBeNull();
  });

  it('keeps paid benefits when checkout is disabled and revokes them at expiry', async () => {
    process.env.PAYMENT_MODE = 'disabled';
    expect(await subscriptions.current(alice)).toMatchObject({
      tier: 'gold',
    });
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
    const changes = { changed: jest.fn().mockResolvedValue(undefined) };
    const expiry = new ExpiredPublishingService(
      property as never,
      changes as never,
    );
    await Promise.all([expiry.reconcile(alice), expiry.reconcile(alice)]);
    expect(
      await property.property.count({
        where: { userId: alice, status: 'Active' },
      }),
    ).toBe(1);
    expect(
      await property.property.count({
        where: { userId: alice, status: 'Draft' },
      }),
    ).toBe(1);
    expect(changes.changed).toHaveBeenCalledTimes(1);
  });

  it('keeps a recoverable pending payment if saving the subscription fails', async () => {
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
      ).toBe(1);
      expect(
        await payment.paymentTransaction.findFirst({
          where: { userId: bob },
        }),
      ).toMatchObject({ status: 'Pending', paidAt: null });
    } finally {
      await owner.query(
        'DROP TRIGGER reject_test_subscription ON payment.subscriptions; DROP FUNCTION payment.reject_test_subscription()',
      );
    }
  });

  it('keeps the free listing alongside paid posts and allows both to be reactivated', async () => {
    const free = await lifecycle.create(bob, input);
    const paid = await lifecycle.create(bob, { ...input, status: 'Draft' });
    await expect(
      checkout.initiate(bob, paid.id, randomUUID()),
    ).resolves.toMatchObject({ status: 'Success' });
    const expiry = new ExpiredPublishingService(
      property as never,
      { changed: async () => {} } as never,
    );
    await expiry.reconcile(bob);
    expect(
      await property.property.count({
        where: { userId: bob, status: 'Active' },
      }),
    ).toBe(2);
    expect(await allowance.usage(bob)).toEqual({ used: 1, listingLimit: 1 });
    await lifecycle.unpublish(bob, paid.id);
    await expect(lifecycle.publish(bob, paid.id)).resolves.toMatchObject({
      status: 'Active',
    });
    await lifecycle.unpublish(bob, free.id);
    await expect(lifecycle.publish(bob, free.id)).resolves.toMatchObject({
      status: 'Active',
    });
    await expect(lifecycle.create(bob, input)).rejects.toMatchObject({
      status: 402,
    });
  });

  it('uses the free slot after individual expiry, allows subscription coverage, and renews for 30 days', async () => {
    const paid = await payment.paymentTransaction.findFirstOrThrow({
      where: { userId: bob, purpose: 'LISTING_PUBLISH', status: 'Success' },
    });
    const free = await property.property.findFirstOrThrow({
      where: { userId: bob, status: 'Active', id: { not: paid.propertyId! } },
    });
    const expiry = new ExpiredPublishingService(
      property as never,
      { changed: async () => {} } as never,
    );
    await payment.paymentTransaction.update({
      where: { id: paid.id },
      data: { listingPeriodEnd: new Date(Date.now() - 1000) },
    });
    await expiry.reconcile(bob);
    expect(
      await property.property.findUnique({ where: { id: paid.propertyId! } }),
    ).toMatchObject({ status: 'Draft' });
    await lifecycle.unpublish(bob, free.id);
    await expect(
      lifecycle.publish(bob, paid.propertyId!),
    ).resolves.toMatchObject({ status: 'Active' });
    await lifecycle.unpublish(bob, paid.propertyId!);
    await lifecycle.publish(bob, free.id);
    const pending = await payment.paymentTransaction.findFirstOrThrow({
      where: { userId: bob, purpose: 'SUBSCRIPTION', status: 'Pending' },
    });
    await gateway.reconcile(pending.id);
    await expect(
      lifecycle.publish(bob, paid.propertyId!),
    ).resolves.toMatchObject({ status: 'Active' });
    const end = new Date(Date.now() - 1000);
    await payment.subscription.update({
      where: { userId: bob },
      data: {
        currentPeriodStart: new Date(end.getTime() - 86400000),
        currentPeriodEnd: end,
      },
    });
    await expiry.reconcile(bob);
    expect(
      await property.property.findUnique({ where: { id: paid.propertyId! } }),
    ).toMatchObject({ status: 'Draft' });
    const renewed = await checkout.initiate(
      bob,
      paid.propertyId!,
      randomUUID(),
    );
    expect(renewed.status).toBe('Success');
    expect(
      (
        await payment.paymentTransaction.findUniqueOrThrow({
          where: { id: renewed.transactionId },
        })
      ).listingPeriodEnd!.getTime(),
    ).toBeGreaterThan(Date.now());
    expect(await allowance.usage(bob)).toEqual({ used: 1, listingLimit: 1 });
  });

  it('retains income from tiers and one-time payments after banning and erasing an account', async () => {
    // Alice has a tier payment; add a settled listing payment to check both foreign keys.
    const listing = await lifecycle.create(alice, {
      ...input,
      status: 'Draft',
    });
    const paid = await checkout.initiate(alice, listing.id, randomUUID());
    const before = await payment.paymentTransaction.findMany({
      where: { userId: alice, status: 'Success' },
      orderBy: { id: 'asc' },
    });
    const income = new AdminIncomeService(payment as never);
    const now = new Date();
    const summary = await income.summary(now);
    await owner.query(
      'UPDATE account.users SET banned_at = now(), deactivated_at = now() WHERE id = $1',
      [alice],
    );
    expect(await income.summary(now)).toEqual(summary);
    await property.property.delete({ where: { id: listing.id } });
    expect(
      await payment.paymentTransaction.findUnique({
        where: { id: paid.transactionId },
      }),
    ).toMatchObject({ userId: alice, propertyId: null, status: 'Success' });
    await owner.query('DELETE FROM account.users WHERE id = $1', [alice]);
    expect(await income.summary(now)).toEqual(summary);
    const ids = before.map((row) => row.id);
    const after = await payment.paymentTransaction.findMany({
      where: { id: { in: ids } },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(
      before.map((row) => ({ ...row, userId: null, propertyId: null })),
    );
    expect(await property.property.count({ where: { userId: alice } })).toBe(0);
    expect(
      await payment.subscription.findUnique({ where: { userId: alice } }),
    ).toBeNull();
    await payment.paymentTransaction.deleteMany({
      where: { id: { in: ids } },
    });
  });
}
