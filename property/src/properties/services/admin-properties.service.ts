import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import {
  OWNER_CARD_SELECT,
  PROPERTY_WITH_RELATIONS,
} from '../property-includes';
import { PropertyLifecycleService } from './property-lifecycle.service';
import { ListingChanges } from './listing-changes.service';
import { UpdatePropertyDto } from '../dto/update-property.dto';
import {
  PropertyEngagementCounts,
  withEngagement,
} from './property-engagement-counts.service';
import { CACHED_LISTING_SELECT } from './public-property-cache.service';

@Injectable()
export class AdminPropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: PropertyLifecycleService,
    private readonly changes: ListingChanges,
    private readonly counts: PropertyEngagementCounts,
  ) {}

  async detail(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: PROPERTY_WITH_RELATIONS,
    });
    if (!property) throw new NotFoundException('Property not found');
    return withEngagement(property, await this.counts.of([id]));
  }

  async ownerId(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!property) throw new NotFoundException('Property not found');
    return property.userId;
  }

  async batch(ids: string[]) {
    return this.prisma.property.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        userId: true,
        title: true,
        price: true,
        status: true,
        propertyType: true,
        createdAt: true,
        images: { orderBy: { order: 'asc' }, take: 1 },
        user: { select: OWNER_CARD_SELECT },
      },
    });
  }

  async update(id: string, dto: UpdatePropertyDto) {
    return this.lifecycle.update(await this.ownerId(id), id, dto);
  }

  async remove(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      select: { ...CACHED_LISTING_SELECT, status: true },
    });
    if (!property) throw new NotFoundException('Property not found');
    // Retain financial and report records; a removed listing cannot be republished by its owner.
    if (property.status !== 'Deleted') {
      await this.prisma.property.update({
        where: { id },
        data: { status: 'Deleted' },
      });
      await this.changes.changed(property);
    }
    return { id, status: 'Deleted' };
  }
}
