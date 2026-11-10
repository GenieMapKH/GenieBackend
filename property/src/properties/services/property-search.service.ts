import { Injectable } from '@nestjs/common';
import { ReadPrisma } from '@tilomnov/shared';
import { MAP_SELECT, PUBLISHED } from '../property-includes';
import { PropertyEngagementCounts } from './property-engagement-counts.service';
import { PublicPropertyCache } from './public-property-cache.service';

/** Published listings found by what they say or who posted them. Public reads: a moment old is fine. */
@Injectable()
export class PropertySearchService {
  constructor(
    private readonly prisma: ReadPrisma,
    private readonly publicCache: PublicPropertyCache,
    private readonly counts: PropertyEngagementCounts,
  ) {}

  /**
   * Published listings whose title or description contains every one of
   * `terms` (already normalized, see `normalizeSearchText`), newest first.
   */
  matching(terms: string[], limit: number) {
    if (terms.length === 0) return Promise.resolve([]);

    return this.publicCache.textSearch(
      `${limit}:${terms.join(' ')}`,
      async () =>
        this.counts.attach(
          await this.prisma.property.findMany({
            where: {
              ...PUBLISHED,
              AND: terms.map((term) => ({
                OR: [
                  { title: { contains: term, mode: 'insensitive' as const } },
                  {
                    description: {
                      contains: term,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              })),
            },
            select: MAP_SELECT,
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
        ),
    );
  }

  /**
   * The published listings among `ids`, in the order of `ids` (a search
   * engine's ranking). An id no longer published is left out, however stale
   * the engine that found it.
   */
  async byIds(ids: string[]) {
    if (ids.length === 0) return [];
    const listings = await this.prisma.property.findMany({
      where: { ...PUBLISHED, id: { in: ids } },
      select: MAP_SELECT,
    });
    return this.counts.attach(inOrderOf(ids, listings));
  }

  /** One owner's published listings, newest first. */
  byOwner(ownerId: string, limit: number) {
    return this.publicCache.ownerListings(ownerId, `${limit}`, async () =>
      this.counts.attach(
        await this.prisma.property.findMany({
          where: { ...PUBLISHED, userId: ownerId },
          select: MAP_SELECT,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      ),
    );
  }
}

/** `rows` sorted as their ids are in `ids`. */
export function inOrderOf<T extends { id: string }>(
  ids: string[],
  rows: T[],
): T[] {
  const position = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
  );
}
