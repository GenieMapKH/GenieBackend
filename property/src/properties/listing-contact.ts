import { BadRequestException } from '@nestjs/common';
import { normalizePhoneNumber, PrismaService } from '@tilomnov/shared';

/** Every public listing needs a verified account phone and a callable listing number. */
export async function requireListingContact(
  prisma: PrismaService,
  userId: string,
  contactPhone?: string | null,
): Promise<string> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, phoneVerified: true },
  });
  if (!owner?.phone || !normalizePhoneNumber(owner.phone))
    throw new BadRequestException({
      code: 'CONTACT_PHONE_REQUIRED',
      message: 'Add a phone number to your account before publishing.',
    });
  const phone = normalizePhoneNumber(contactPhone ?? owner.phone);
  if (!owner.phoneVerified)
    throw new BadRequestException({
      code: 'PHONE_VERIFICATION_REQUIRED',
      message: 'Verify your account phone with SMS before publishing.',
    });
  if (!phone)
    throw new BadRequestException('Enter a valid contact phone number');
  return phone;
}
