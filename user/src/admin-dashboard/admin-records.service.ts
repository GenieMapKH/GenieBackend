import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRecordsQuery } from './admin-records.query';

const PAGE_SIZE = 50;
// Explicit selection keeps credentials, identity keys and encrypted backups out of admin responses.
const ACCOUNT_INFO = {
  id: true,
  username: true,
  avatarUrl: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  emailVerified: true,
  phoneVerified: true,
  role: true,
  createdAt: true,
  deactivatedAt: true,
  bannedAt: true,
  lastSeenAt: true,
} as const;

interface RemotePage {
  items: { userId: string | null; [key: string]: unknown }[];
  nextOffset: number | null;
}

@Injectable()
export class AdminRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: AdminDashboardService,
  ) {}

  async list(query: AdminRecordsQuery) {
    const { section, offset } = query;
    const q = query.q?.trim();
    const uuid =
      q &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)
        ? q
        : undefined;
    const accountSearch = q
      ? {
          OR: [
            ...(uuid ? [{ id: uuid }] : []),
            ...[
              'username',
              'name',
              'firstName',
              'lastName',
              'email',
              'phone',
            ].map((field) => ({
              [field]: { contains: q, mode: 'insensitive' },
            })),
          ],
        }
      : {};
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (['active-users', 'all-users', 'new-users'].includes(section)) {
      const rows = await this.prisma.user.findMany({
        where: {
          role: 'user',
          ...accountSearch,
          ...(section === 'active-users' && { deactivatedAt: null }),
          ...(section === 'new-users' && { createdAt: { gte: since } }),
        },
        select: ACCOUNT_INFO,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: PAGE_SIZE + 1,
      });
      return this.page(rows, offset);
    }
    if (section === 'reports') {
      const rows = await this.prisma.report.findMany({
        where: {
          status: 'open',
          ...(q && {
            OR: [
              ...(uuid ? [{ id: uuid }, { propertyId: uuid }] : []),
              ...['reason', 'details'].map((field) => ({
                [field]: { contains: q, mode: 'insensitive' },
              })),
              { reporter: accountSearch },
              { reportedUser: accountSearch },
            ],
          }),
        },
        select: {
          id: true,
          propertyId: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
          reporter: { select: ACCOUNT_INFO },
          reportedUser: { select: ACCOUNT_INFO },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: PAGE_SIZE + 1,
      });
      return this.page(rows, offset);
    }
    const payment = [
      'subscriptions',
      'successful-payments',
      'pending-payments',
    ].includes(section);
    const search = new URLSearchParams({ section, offset: String(offset) });
    if (query.tier) search.set('tier', query.tier);
    if (q) search.set('q', q);
    if (query.purpose) search.set('purpose', query.purpose);
    const page = await this.dashboard.internalGet<RemotePage>(
      payment ? 'payment' : 'property',
      payment ? 'PAYMENT_SERVICE_URL' : 'PROPERTY_SERVICE_URL',
      payment ? 4005 : 4003,
      `/records?${search}`,
    );
    // Account data stays in its owning service; enrich the bounded page in one query.
    const accounts = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              page.items
                .map((item) => item.userId)
                .filter((id): id is string => id !== null),
            ),
          ],
        },
      },
      select: ACCOUNT_INFO,
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        account: item.userId ? (byId.get(item.userId) ?? null) : null,
      })),
    };
  }

  private page<T>(rows: T[], offset: number) {
    return {
      items: rows.slice(0, PAGE_SIZE),
      nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
    };
  }
}
