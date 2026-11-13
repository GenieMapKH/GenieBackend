import { Injectable, NotFoundException } from '@nestjs/common';
import { ReadPrisma } from '@tilomnov/shared';
import { inOrderOf } from '../properties/services/property-search.service';

/** What a list of search results shows of a person: no contact details. */
export interface PublisherSummary {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  /** Published listings only. */
  listingCount: number;
  /** When the account was created. */
  memberSince: Date;
}

/**
 * Someone's own profile page (opened from search or from a chat) adds how to
 * reach them, but only for publishers. Someone who has published nothing
 * keeps theirs private. Never in result lists, so a search cannot collect
 * contact details in bulk; and only a limited number of pages a day show them
 * (`ContactDetailsInterceptor`).
 */
export interface PublisherProfile extends PublisherSummary {
  isAdmin: boolean;
  email: string | null;
  phone: string | null;
}

/** Someone the public may find: not deactivated, with at least one published listing. */
export const PUBLISHER = {
  deactivatedAt: null,
  properties: { some: { status: 'Active' } },
} as const;

const PUBLISHER_SELECT = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  createdAt: true,
  _count: { select: { properties: { where: { status: 'Active' } } } },
} as const;

const PROFILE_SELECT = {
  ...PUBLISHER_SELECT,
  role: true,
  properties: {
    where: { status: 'Active', contactPhone: { not: null } },
    select: { contactPhone: true },
    orderBy: { publishedAt: 'desc' },
    take: 1,
  },
} as const;

type PublisherRow = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  _count: { properties: number };
};

/**
 * Finds the people and agencies who post listings. Accounts that have never
 * published anything cannot be found, so search is no directory of users.
 */
@Injectable()
export class PeopleSearchService {
  /** Public reads: a moment old is fine. */
  constructor(private readonly prisma: ReadPrisma) {}

  /** Publishers whose name or username contains every one of `terms`; the busiest first. */
  async matching(terms: string[], limit: number): Promise<PublisherSummary[]> {
    if (terms.length === 0) return [];

    const rows = await this.prisma.user.findMany({
      where: {
        ...PUBLISHER,
        AND: terms.map((term) => ({
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { username: { contains: term, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: PUBLISHER_SELECT,
      orderBy: { properties: { _count: 'desc' } },
      take: limit,
    });
    return rows.map(toSummary);
  }

  /**
   * The publishers among `ids`, in the order of `ids` (a search engine's
   * ranking). Someone who has since hidden their account or unpublished
   * everything is left out, however stale the engine that found them.
   */
  async byIds(ids: string[]): Promise<PublisherSummary[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { ...PUBLISHER, id: { in: ids } },
      select: PUBLISHER_SELECT,
    });
    return inOrderOf(ids, rows).map(toSummary);
  }

  /**
   * Anyone's profile, publisher or not (people chat before they list
   * anything); 404 when the account is missing or deactivated. It can only be
   * reached by id: search finds publishers alone.
   */
  async findProfile(id: string): Promise<PublisherProfile> {
    const row = await this.prisma.user.findFirst({
      where: { id, deactivatedAt: null },
      select: PROFILE_SELECT,
    });
    if (!row) {
      throw new NotFoundException('User not found');
    }
    const summary = toSummary(row);
    const publishes = summary.listingCount > 0;
    return {
      ...summary,
      isAdmin: row.role === 'admin',
      email: null,
      phone: publishes ? (row.properties[0]?.contactPhone ?? null) : null,
    };
  }
}

function toSummary(row: PublisherRow): PublisherSummary {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    avatarUrl: row.avatarUrl,
    listingCount: row._count.properties,
    memberSince: row.createdAt,
  };
}
