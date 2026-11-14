import { requireListingContact } from './listing-contact';

describe('listing contact requirement', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const contact = (number?: string) =>
    requireListingContact(prisma as never, 'owner', number);
  it('blocks phone-less OAuth users even when the listing supplies a number', async () => {
    prisma.user.findUnique.mockResolvedValue({ phone: null });
    await expect(contact('012345678')).rejects.toMatchObject({ status: 400 });
  });
  it('rejects an unverified account phone even when a listing supplies a number', async () => {
    prisma.user.findUnique.mockResolvedValue({
      phone: '+85512345678',
      phoneVerified: false,
    });
    await expect(contact('012345678')).rejects.toMatchObject({
      response: { code: 'PHONE_VERIFICATION_REQUIRED' },
      status: 400,
    });
  });
  it('prefills the account number and normalizes an explicit listing contact', async () => {
    prisma.user.findUnique.mockResolvedValue({
      phone: '+85512345678',
      phoneVerified: true,
    });
    expect(await contact()).toBe('+85512345678');
    expect(await contact('098 765 432')).toBe('+85598765432');
    await expect(contact('not-a-number')).rejects.toMatchObject({
      status: 400,
    });
  });
});
