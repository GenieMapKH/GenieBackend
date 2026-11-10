import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { MIN_SEARCH_LENGTH, normalizeSearchText } from '../search-text';

/** How long a search is remembered. */
export const HISTORY_RETENTION_DAYS = 14;

/** Shown to the user: the most recent first. */
const HISTORY_LIMIT = 20;

/** Kept per user; older ones are dropped as new ones come in. */
const HISTORY_KEEP = 50;

const ENTRY_SELECT = { id: true, query: true, searchedAt: true } as const;

/**
 * What each account searched, on every device it signs in on. One entry per
 * distinct text: searching it again moves it to the top.
 */
@Injectable()
export class SearchHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's searches of the last 14 days, newest first. */
  list(userId: string, now = new Date()) {
    return this.prisma.searchHistoryEntry.findMany({
      where: { userId, searchedAt: { gte: retentionStart(now) } },
      select: ENTRY_SELECT,
      orderBy: { searchedAt: 'desc' },
      take: HISTORY_LIMIT,
    });
  }

  /** Remembers `query` (already validated as 2-80 characters) as searched now. */
  async record(userId: string, query: string, now = new Date()) {
    const text = query.trim();
    const normalizedQuery = normalizeSearchText(text);
    if (normalizedQuery.length < MIN_SEARCH_LENGTH) {
      throw new BadRequestException('Nothing to search for');
    }

    const entry = await this.prisma.searchHistoryEntry.upsert({
      where: { userId_normalizedQuery: { userId, normalizedQuery } },
      create: { userId, query: text, normalizedQuery, searchedAt: now },
      update: { query: text, searchedAt: now },
      select: ENTRY_SELECT,
    });

    await this.forgetOld(userId, now);
    return entry;
  }

  /** 404 when the entry is missing or someone else's: the two look the same. */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.searchHistoryEntry.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException('Search not found');
    }
  }

  /**
   * Deletes everyone's searches past the retention period (the index on
   * `searched_at` keeps this cheap), and this user's beyond the newest 50.
   */
  private async forgetOld(userId: string, now: Date): Promise<void> {
    const beyondKept = await this.prisma.searchHistoryEntry.findMany({
      where: { userId },
      select: { id: true },
      orderBy: { searchedAt: 'desc' },
      skip: HISTORY_KEEP,
    });

    await this.prisma.searchHistoryEntry.deleteMany({
      where: {
        OR: [
          { searchedAt: { lt: retentionStart(now) } },
          { id: { in: beyondKept.map((entry) => entry.id) } },
        ],
      },
    });
  }
}

function retentionStart(now: Date): Date {
  return new Date(now.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
