import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePropertyDto } from './dto/create-property.dto';
import { TakeoverDto } from './dto/takeover.dto';
import { assertTakeoverComplete, takeoverPrice } from './takeover';
import { toCreateData, toUpdateData } from './property-write-data';
import { PropertyLifecycleService } from './services/property-lifecycle.service';
import { PropertyStatusService } from './property-status.service';

export const terms: TakeoverDto = {
  providerType: 'Developer',
  providerName: 'Example Developer',
  projectName: 'Example Project',
  sellerAmount: 20000.25,
  remainingBalance: 60000,
  balanceAsOf: '2026-11-08',
  paymentAmount: 500,
  paymentFrequency: 'Monthly',
  remainingMonths: 120,
  nextPaymentDate: '2026-12-08',
  interestType: 'None',
  transferStatus: 'Conditional',
  transferFee: null,
  transferFeePayer: 'Buyer',
  arrearsAmount: 0,
  hasAdditionalPayments: false,
  additionalPayments: [],
};
const listing: CreatePropertyDto = {
  title: 'Take over this house',
  propertyType: 'House',
  price: 1,
  listingType: 'Takeover Payments',
  status: 'Active',
  takeover: terms,
};

describe('takeover terms', () => {
  it('uses both obligations as the price and keeps cents', () => {
    expect(takeoverPrice(terms)).toBe(80000.25);
    expect(toCreateData('owner', listing)).toMatchObject({
      price: 80000.25,
      takeover: { create: { sellerAmount: 20000.25, remainingBalance: 60000 } },
    });
    expect(() => assertTakeoverComplete(listing)).not.toThrow();
  });

  it.each([
    'providerType',
    'providerName',
    'projectName',
    'sellerAmount',
    'remainingBalance',
    'balanceAsOf',
    'paymentAmount',
    'paymentFrequency',
    'remainingMonths',
    'nextPaymentDate',
    'interestType',
    'transferStatus',
    'transferFeePayer',
    'arrearsAmount',
    'hasAdditionalPayments',
  ])('requires %s before publication', (field) => {
    expect(() =>
      assertTakeoverComplete({
        ...listing,
        takeover: { ...terms, [field]: null },
      }),
    ).toThrow(BadRequestException);
  });

  it.each([
    { remainingBalance: 0 },
    { paymentAmount: 0 },
    { transferStatus: 'Not allowed' },
    { interestType: 'Fixed', annualInterestRate: null },
    { interestType: 'Variable', annualInterestRate: null },
    { annualInterestRate: 5 },
    { arrearsAmount: 100, arrearsPayer: null },
    { arrearsAmount: 100, arrearsPayer: 'Buyer', notes: '' },
    { hasAdditionalPayments: true, additionalPayments: [] },
    {
      hasAdditionalPayments: true,
      additionalPayments: [{ amount: 100, dueDate: null }],
    },
    {
      hasAdditionalPayments: true,
      additionalPayments: [{ amount: 60001, dueDate: '2027-01-01' }],
    },
  ])('refuses inconsistent terms: %j', (patch) => {
    expect(() =>
      assertTakeoverComplete({ ...listing, takeover: { ...terms, ...patch } }),
    ).toThrow(BadRequestException);
  });

  it('does not add balloon payments to the balance a second time', () => {
    const takeover = {
      ...terms,
      hasAdditionalPayments: true,
      additionalPayments: [{ amount: 10000, dueDate: '2027-01-01' }],
    };
    expect(() =>
      assertTakeoverComplete({ ...listing, takeover }),
    ).not.toThrow();
    expect(takeoverPrice(takeover)).toBe(80000.25);
  });

  it('rejects a combined amount that overflows the price column', () => {
    expect(() =>
      takeoverPrice({ sellerAmount: 9999999999, remainingBalance: 1 }),
    ).toThrow(BadRequestException);
  });

  it('refuses discounts on takeover obligations', () => {
    expect(() =>
      assertTakeoverComplete({ ...listing, discountValue: 10 }),
    ).toThrow(BadRequestException);
  });

  it('replaces terms and deletes them when switching away', () => {
    expect(
      toUpdateData({ takeover: terms }, 'House', 'Takeover Payments', true)
        .takeover,
    ).toHaveProperty('upsert.update.additionalPayments.deleteMany');
    expect(
      toUpdateData({ listingType: 'Sale' }, 'House', 'Takeover Payments', true)
        .takeover,
    ).toEqual({ delete: true });
    expect(
      toUpdateData({ title: 'Changed' }, 'House', 'Takeover Payments', true),
    ).not.toHaveProperty('takeover');
  });

  it.each([
    { sellerAmount: -1 },
    { paymentAmount: '500' },
    { remainingMonths: 1.5 },
    { balanceAsOf: '2026-02-30' },
    { nextPaymentDate: 'yesterday' },
    { annualInterestRate: 101 },
    { transferFee: 1.111 },
    { additionalPayments: [{ amount: -1, dueDate: '2027-01-01' }] },
  ])('validates nested input at the API boundary: %j', async (patch) => {
    const dto = plainToInstance(CreatePropertyDto, {
      ...listing,
      takeover: { ...terms, ...patch },
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts incomplete draft terms, including an unfinished extra payment', async () => {
    const dto = plainToInstance(CreatePropertyDto, {
      ...listing,
      status: 'Draft',
      takeover: { hasAdditionalPayments: true, additionalPayments: [{}] },
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(toCreateData('owner', dto).takeover).toHaveProperty(
      'create.additionalPayments.create.0.dueDate',
      null,
    );
  });
});

describe('takeover publication paths', () => {
  const table = { create: jest.fn(), update: jest.fn() };
  const query = { findOwned: jest.fn() };
  const changes = { changed: jest.fn(), priceDropped: jest.fn() };
  const counts = { of: jest.fn().mockResolvedValue(new Map()) };
  const allowance = {
    publish: (_: string, write: (db: unknown) => unknown) =>
      write({ property: table }),
  };
  const service = new PropertyLifecycleService(
    {
      property: table,
      user: {
        findUnique: jest.fn().mockResolvedValue({ phone: '+85512345678' }),
      },
    } as never,
    query as never,
    new PropertyStatusService(),
    changes as never,
    {} as never,
    counts as never,
    allowance as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    query.findOwned.mockResolvedValue({
      ...listing,
      id: 'p1',
      userId: 'owner',
      status: 'Draft',
      takeover: null,
    });
  });

  it('blocks immediate publication without terms before writing', async () => {
    await expect(
      service.create('owner', { ...listing, takeover: null }),
    ).rejects.toThrow(BadRequestException);
    expect(table.create).not.toHaveBeenCalled();
  });

  it.each(['publish', 'relist'] as const)(
    'blocks %s of an incomplete saved listing',
    async (method) => {
      if (method === 'relist')
        query.findOwned.mockResolvedValue({
          ...listing,
          id: 'p1',
          status: 'Sold',
          takeover: null,
        });
      await expect(service[method]('owner', 'p1')).rejects.toThrow(
        BadRequestException,
      );
      expect(table.update).not.toHaveBeenCalled();
    },
  );

  it.each(['Active', 'Pending'])(
    'blocks incomplete edits while %s',
    async (status) => {
      query.findOwned.mockResolvedValue({
        ...listing,
        id: 'p1',
        status,
        takeover: terms,
      });
      await expect(
        service.update('owner', 'p1', { takeover: null }),
      ).rejects.toThrow(BadRequestException);
      expect(table.update).not.toHaveBeenCalled();
    },
  );

  it('ignores a forged total price when editing a live takeover', async () => {
    const before = {
      ...listing,
      id: 'p1',
      status: 'Active',
      price: '80000.25',
      discountType: null,
      discountValue: null,
      previousPrice: null,
      takeover: terms,
    };
    query.findOwned.mockResolvedValue(before);
    table.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...before, ...data }),
    );
    await service.update('owner', 'p1', { price: 1 });
    expect(table.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ price: 80000.25 }),
      }),
    );
  });
});
