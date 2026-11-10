import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './saved-search.dto';

/** The most searches one account keeps: each is checked against every new listing. */
export const MAX_SAVED_SEARCHES = 20;

/** A saved search as the app shows it and can open on the map again. */
export interface SavedSearchView {
  id: string;
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  propertyType: string | null;
  listingTypes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  minSize: number | null;
  maxSize: number | null;
  keywords: string[];
  alerts: boolean;
  createdAt: Date;
}

type SavedSearchRow = Prisma.SavedSearchGetPayload<object>;

/** A person's saved map searches. Nobody else's can be read or changed. */
@Injectable()
export class SavedSearchesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first. */
  async list(userId: string): Promise<SavedSearchView[]> {
    const rows = await this.prisma.savedSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async create(
    userId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearchView> {
    assertOrdered('latitude', dto.minLat, dto.maxLat);
    assertOrdered('longitude', dto.minLng, dto.maxLng);
    assertOrdered('price', dto.minPrice, dto.maxPrice);
    assertOrdered('size', dto.minSize, dto.maxSize);

    const count = await this.prisma.savedSearch.count({ where: { userId } });
    if (count >= MAX_SAVED_SEARCHES) {
      throw new ConflictException(
        `You can save at most ${MAX_SAVED_SEARCHES} searches`,
      );
    }
    const row = await this.prisma.savedSearch.create({
      data: {
        userId,
        name: dto.name,
        minLat: dto.minLat,
        maxLat: dto.maxLat,
        minLng: dto.minLng,
        maxLng: dto.maxLng,
        propertyType: dto.propertyType ?? null,
        listingTypes: [...new Set(dto.listingTypes ?? [])],
        minPrice: dto.minPrice ?? null,
        maxPrice: dto.maxPrice ?? null,
        minSize: dto.minSize ?? null,
        maxSize: dto.maxSize ?? null,
        keywords: [...new Set(dto.keywords ?? [])],
        alerts: dto.alerts ?? true,
      },
    });
    return toView(row);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSavedSearchDto,
  ): Promise<SavedSearchView> {
    const { count } = await this.prisma.savedSearch.updateMany({
      where: { id, userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.alerts !== undefined && { alerts: dto.alerts }),
      },
    });
    if (count === 0) throw new NotFoundException('Saved search not found');
    const row = await this.prisma.savedSearch.findUniqueOrThrow({
      where: { id },
    });
    return toView(row);
  }

  /** Removing one already gone changes nothing. */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.savedSearch.deleteMany({ where: { id, userId } });
  }
}

function assertOrdered(what: string, min?: number, max?: number): void {
  if (min != null && max != null && min > max) {
    throw new BadRequestException(`The lowest ${what} is above the highest`);
  }
}

const asNumber = (value: Prisma.Decimal | null) =>
  value === null ? null : value.toNumber();

function toView(row: SavedSearchRow): SavedSearchView {
  return {
    id: row.id,
    name: row.name,
    minLat: row.minLat,
    maxLat: row.maxLat,
    minLng: row.minLng,
    maxLng: row.maxLng,
    propertyType: row.propertyType,
    listingTypes: row.listingTypes,
    minPrice: asNumber(row.minPrice),
    maxPrice: asNumber(row.maxPrice),
    minSize: asNumber(row.minSize),
    maxSize: asNumber(row.maxSize),
    keywords: row.keywords,
    alerts: row.alerts,
    createdAt: row.createdAt,
  };
}
