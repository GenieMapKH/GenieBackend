import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@tilomnov/prisma-client';
import { TakeoverDto } from './dto/takeover.dto';
import { MAP_SELECT, PROPERTY_WITH_RELATIONS } from './property-includes';
import { FEED_CARD_SELECT } from '../feed/feed-card.select';
import { toCreateData, toUpdateData } from './property-write-data';

/** Opt-in check against a disposable local database with migration 40 applied. */
const database = process.env.TAKEOVER_TEST_DATABASE_URL;
const integration = database ? describe : describe.skip;

integration('takeover persistence (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const owner = randomUUID();
  const terms: TakeoverDto = {
    providerType: 'Developer',
    providerName: 'Test Developer',
    projectName: 'Test Project',
    sellerAmount: 20000.25,
    remainingBalance: 60000,
    balanceAsOf: '2026-11-08',
    paymentAmount: 500.75,
    paymentFrequency: 'Monthly',
    remainingMonths: 120,
    nextPaymentDate: '2026-12-08',
    interestType: 'None',
    transferStatus: 'Conditional',
    transferFeePayer: 'Buyer',
    arrearsAmount: 0,
    hasAdditionalPayments: true,
    additionalPayments: [
      { amount: 10000, dueDate: '2027-01-01' },
      { amount: 5000, dueDate: '2028-01-01' },
    ],
  };

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(database!).hostname)) {
      throw new Error(
        'Use a disposable local PostgreSQL database for this check.',
      );
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: database }),
    });
    await prisma.user.create({
      data: {
        id: owner,
        email: `${owner}@example.invalid`,
        passwordHash: 'test-only',
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: owner } });
      await prisma.$disconnect();
    }
  });

  it('creates terms, serves map/feed details, replaces schedules, clears and cascades them', async () => {
    const property = await prisma.property.create({
      data: toCreateData(owner, {
        title: 'Takeover integration',
        price: 1,
        propertyType: 'House',
        listingType: 'Takeover Payments',
        status: 'Active',
        takeover: terms,
      }),
      include: PROPERTY_WITH_RELATIONS,
    });
    expect(property.price.toString()).toBe('80000.25');
    expect(
      property.takeover?.additionalPayments.map((p) => p.amount?.toString()),
    ).toEqual(['10000', '5000']);
    const map = await prisma.property.findUniqueOrThrow({
      where: { id: property.id },
      select: MAP_SELECT,
    });
    expect(map.takeover?.providerName).toBe('Test Developer');
    const feed = await prisma.property.findUniqueOrThrow({
      where: { id: property.id },
      select: FEED_CARD_SELECT,
    });
    expect(feed.takeover?.paymentAmount?.toString()).toBe('500.75');
    const updated = await prisma.property.update({
      where: { id: property.id },
      data: toUpdateData(
        {
          takeover: {
            ...terms,
            annualInterestRate: null,
            additionalPayments: [{ amount: 12000.5, dueDate: '2029-01-01' }],
          },
        },
        'House',
        'Takeover Payments',
        true,
      ),
      include: PROPERTY_WITH_RELATIONS,
    });
    expect(updated.takeover?.additionalPayments).toHaveLength(1);
    expect(updated.takeover?.additionalPayments[0].amount?.toString()).toBe(
      '12000.5',
    );
    await prisma.property.update({
      where: { id: property.id },
      data: toUpdateData(
        { listingType: 'Sale' },
        'House',
        'Takeover Payments',
        true,
      ),
    });
    expect(
      await prisma.propertyTakeover.findUnique({
        where: { propertyId: property.id },
      }),
    ).toBeNull();
    expect(
      await prisma.propertyTakeoverPayment.count({
        where: { propertyId: property.id },
      }),
    ).toBe(0);
    await prisma.property.update({
      where: { id: property.id },
      data: toUpdateData(
        { listingType: 'Takeover Payments', takeover: terms },
        'House',
        'Sale',
        false,
      ),
    });
    await prisma.property.delete({ where: { id: property.id } });
    expect(
      await prisma.propertyTakeover.count({
        where: { propertyId: property.id },
      }),
    ).toBe(0);
    expect(
      await prisma.propertyTakeoverPayment.count({
        where: { propertyId: property.id },
      }),
    ).toBe(0);
  });

  it('stores unfinished schedule rows in a private draft', async () => {
    const draft = await prisma.property.create({
      data: toCreateData(owner, {
        title: 'Draft',
        price: 0,
        propertyType: 'Land',
        listingType: 'Takeover Payments',
        status: 'Draft',
        takeover: {
          hasAdditionalPayments: true,
          additionalPayments: [{ amount: null, dueDate: null }],
        },
      }),
      include: PROPERTY_WITH_RELATIONS,
    });
    expect(draft.status).toBe('Draft');
    expect(draft.takeover?.additionalPayments[0].dueDate).toBeNull();
  });

  it('enables row security and limits the new tables to the property service', async () => {
    const rows = await prisma.$queryRaw<
      { name: string; rls: boolean; service: boolean; publicAccess: boolean }[]
    >`
      SELECT relname AS name, relrowsecurity AS rls,
        has_table_privilege('property_service', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0) AS "publicAccess"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'listing' AND relname IN ('property_takeovers', 'property_takeover_payments')`;
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => row.rls && row.service && !row.publicAccess),
    ).toBe(true);
  });
});
