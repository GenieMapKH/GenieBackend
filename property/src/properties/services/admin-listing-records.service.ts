import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { toPage } from '../dto/page.query';

@Injectable()
export class AdminListingRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(section: string, offset: number) {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new BadRequestException('Invalid page offset');
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (section === 'leads') {
      const rows = await this.prisma.propertyLead.findMany({
        where: { createdAt: { gte: since } },
        select: {
          propertyId: true,
          userId: true,
          channel: true,
          createdAt: true,
          property: {
            select: { id: true, title: true, status: true, userId: true },
          },
        },
        orderBy: [
          { createdAt: 'desc' },
          { propertyId: 'asc' },
          { userId: 'asc' },
          { channel: 'asc' },
        ],
        skip: offset,
        take: 51,
      });
      return toPage(rows, offset, 50);
    }
    if (!['active-listings', 'all-listings', 'new-listings'].includes(section))
      throw new BadRequestException('Invalid listing section');
    const rows = await this.prisma.property.findMany({
      where: {
        ...(section === 'active-listings' && { status: 'Active' }),
        ...(section === 'new-listings' && { createdAt: { gte: since } }),
      },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        price: true,
        propertyType: true,
        listingType: true,
        status: true,
        contactPhone: true,
        bedrooms: true,
        bathrooms: true,
        landSize: true,
        buildingSize: true,
        unitSize: true,
        lat: true,
        lng: true,
        createdAt: true,
        publishedAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: 51,
    });
    return toPage(rows, offset, 50);
  }
}
