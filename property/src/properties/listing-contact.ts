import { BadRequestException } from '@nestjs/common';
import { normalizePhoneNumber, PrismaService } from '@tilomnov/shared';

/** Public listings need a callable contact, not successful OTP delivery. */
export async function requireListingContact(
  prisma: PrismaService,
  userId: string,
  contactPhone?: string | null,
): Promise<string> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  const phone = normalizePhoneNumber(contactPhone ?? owner?.phone ?? '');
  if (!phone)
    throw new BadRequestException('Enter a valid contact phone number');
  return phone;
}
