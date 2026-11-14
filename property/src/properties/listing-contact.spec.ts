import { requireListingContact } from './listing-contact';

describe('listing contact without an OTP gate', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const contact = (number?: string) =>
    requireListingContact(prisma as never, 'owner', number);
  it.each([true, false])(
    'allows account phone with verified=%s',
    async (verified) => {
      prisma.user.findUnique.mockResolvedValue({
        phone: '+85512345678',
        phoneVerified: verified,
      });
      expect(await contact()).toBe('+85512345678');
      expect(prisma.user.findUnique).toHaveBeenLastCalledWith({
        where: { id: 'owner' },
        select: { phone: true },
      });
    },
  );
  it('allows an OAuth user without an account phone to supply a listing contact', async () => {
    prisma.user.findUnique.mockResolvedValue({ phone: null });
    expect(await contact('098 765 432')).toBe('+85598765432');
  });
  it('still rejects missing or malformed contact numbers', async () => {
    prisma.user.findUnique.mockResolvedValue({ phone: null });
    await expect(contact()).rejects.toMatchObject({ status: 400 });
    await expect(contact('not-a-number')).rejects.toMatchObject({
      status: 400,
    });
  });
});
