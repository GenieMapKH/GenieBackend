import { BadRequestException } from '@nestjs/common';
import { normalizePhoneNumber, PrismaService } from '@tilomnov/shared';

/** Every public listing needs an account contact and a callable listing number. */
export async function requireListingContact(
  prisma: PrismaService,
  userId: string,
  contactPhone?: string | null,
): Promise<string> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  if (!owner?.phone || !normalizePhoneNumber(owner.phone))
    throw new BadRequestException({
      code: 'CONTACT_PHONE_REQUIRED',
      message: 'Add a phone number to your account before publishing.',
    });
  const phone = normalizePhoneNumber(contactPhone ?? owner.phone);
  if (!phone)
    throw new BadRequestException('Enter a valid contact phone number');
  return phone;
}
