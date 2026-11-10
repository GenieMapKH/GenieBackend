import { ExecutionContext } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { lastValueFrom, of } from 'rxjs';
import {
  ContactDetailsInterceptor,
  hasContactDetails,
  withoutContactDetails,
} from './contact-details';

const listing = () => ({
  id: 'p1',
  title: 'Villa',
  price: new Prisma.Decimal('120000.50'),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  contactPhone: '012 345 678',
  additionalContactPhones: ['+85598765432'],
  user: { id: 'u1', name: 'Dara', email: 'dara@example.com', phone: '099' },
});

describe('withoutContactDetails', () => {
  it("drops the owner's email and phone and the listing's own phone", () => {
    const result = withoutContactDetails(listing());
    expect(result).not.toHaveProperty('contactPhone');
    expect(result).not.toHaveProperty('additionalContactPhones');
    expect(result.user).toEqual({ id: 'u1', name: 'Dara' });
  });

  it('keeps prices and dates as they are', () => {
    const result = withoutContactDetails(listing());
    expect(result.price).toBeInstanceOf(Prisma.Decimal);
    expect(result.price.toString()).toBe('120000.5');
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('walks lists and nested answers (search, a publisher page)', () => {
    const result = withoutContactDetails({
      person: { id: 'u1', email: 'a@b.c', phone: '1', listingCount: 2 },
      properties: [listing(), listing()],
    });
    expect(result.person).toEqual({ id: 'u1', listingCount: 2 });
    for (const item of result.properties) {
      expect(item.user).toEqual({ id: 'u1', name: 'Dara' });
    }
  });

  it('leaves the original untouched, so a cached answer keeps them', () => {
    const original = listing();
    withoutContactDetails([original]);
    expect(original.user.email).toBe('dara@example.com');
    expect(original.contactPhone).toBe('012 345 678');
  });

  it('passes through what is not an object', () => {
    expect(withoutContactDetails(null)).toBeNull();
    expect(withoutContactDetails('text')).toBe('text');
  });
});

describe('hasContactDetails', () => {
  it('counts extra contacts only when the array has numbers', () => {
    expect(hasContactDetails({ additionalContactPhones: [] })).toBe(false);
    expect(
      hasContactDetails({ additionalContactPhones: ['+85512345678'] }),
    ).toBe(true);
  });
  it('finds a phone or email at any depth', () => {
    expect(hasContactDetails(listing())).toBe(true);
    expect(hasContactDetails({ items: [{ user: { phone: '1' } }] })).toBe(true);
  });

  it('ignores empty ones and lists without them', () => {
    expect(
      hasContactDetails({ contactPhone: null, user: { id: 'u1', phone: '' } }),
    ).toBe(false);
    expect(hasContactDetails([{ id: 'p1', user: { id: 'u1' } }])).toBe(false);
  });
});

describe('ContactDetailsInterceptor', () => {
  /** In-memory limits with the real behaviour: refusing past `points`. */
  const rateLimits = {
    create: (_name: string, points: number, duration: number) =>
      new RateLimiterMemory({ points, duration }),
  };
  let interceptor: ContactDetailsInterceptor;

  const contextFor = (user: { userId: string } | null) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const run = (user: { userId: string } | null, body: unknown = listing()) =>
    lastValueFrom(
      interceptor.intercept(contextFor(user), { handle: () => of(body) }),
    ) as Promise<ReturnType<typeof listing>>;

  beforeEach(() => {
    interceptor = new ContactDetailsInterceptor(rateLimits as never);
  });

  it('hides contact details from a guest', async () => {
    const body = await run(null);
    expect(body.user).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('contactPhone');
  });

  it('shows them to a signed-in user', async () => {
    const body = await run({ userId: 'u2' });
    expect(body.user.phone).toBe('099');
    expect(body.contactPhone).toBe('012 345 678');
  });

  it('stops showing them to an account that opens too many in an hour', async () => {
    for (let i = 0; i < 100; i++) {
      expect((await run({ userId: 'u2' })).contactPhone).toBe('012 345 678');
    }

    const over = await run({ userId: 'u2' });
    expect(over).not.toHaveProperty('contactPhone');
    expect(over.title).toBe('Villa');
    // Someone else is not affected.
    expect((await run({ userId: 'u3' })).contactPhone).toBe('012 345 678');
  });

  it("does not count answers without contact details, or the caller's own", async () => {
    const card = { id: 'p2', title: 'Flat', user: { id: 'u1' } };
    for (let i = 0; i < 150; i++) {
      await run({ userId: 'u2' }, [card]);
      await run({ userId: 'u1' });
    }

    expect((await run({ userId: 'u2' })).contactPhone).toBe('012 345 678');
  });
});
