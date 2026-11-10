import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { AdminPlatformService } from './admin-platform.service';
import { AdminPageQuery } from './admin-moderation.dto';

const PERSON = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
} as const;
@Injectable()
export class AdminReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: AdminPlatformService,
  ) {}

  async groups(query: AdminPageQuery) {
    const q = query.q?.trim();
    const rows = await this.prisma.report.groupBy({
      by: ['propertyId', 'reportedUserId'],
      where: { status: 'open', ...this.search(q) },
      _count: { _all: true },
      orderBy: [
        { _count: { id: 'desc' } },
        { propertyId: 'asc' },
        { reportedUserId: 'asc' },
      ],
      skip: query.offset,
      take: 21,
    });
    const selected = rows.slice(0, 20);
    const totals =
      q && selected.length
        ? await this.prisma.report.groupBy({
            by: ['propertyId', 'reportedUserId'],
            where: {
              status: 'open',
              OR: selected.map((row) =>
                row.propertyId
                  ? { propertyId: row.propertyId }
                  : { reportedUserId: row.reportedUserId },
              ),
            },
            _count: { _all: true },
          })
        : selected;
    const ids = selected.flatMap((row) =>
      row.propertyId ? [row.propertyId] : [],
    );
    const properties = ids.length
      ? await this.platform.property<{ id: string }[]>(
          'POST',
          'properties/batch',
          { ids },
        )
      : [];
    const accounts = await this.prisma.user.findMany({
      where: {
        id: {
          in: selected.flatMap((row) =>
            row.reportedUserId ? [row.reportedUserId] : [],
          ),
        },
      },
      select: PERSON,
    });
    return {
      items: selected.map((row) => ({
        targetType: row.propertyId ? 'property' : 'user',
        targetId: row.propertyId ?? row.reportedUserId,
        reportCount:
          totals.find(
            (total) =>
              total.propertyId === row.propertyId &&
              total.reportedUserId === row.reportedUserId,
          )?._count._all ?? row._count._all,
        property:
          properties.find((property) => property.id === row.propertyId) ?? null,
        account:
          accounts.find((account) => account.id === row.reportedUserId) ?? null,
      })),
      nextOffset: rows.length > 20 ? query.offset + 20 : null,
    };
  }

  async detail(type: string, id: string, query: AdminPageQuery) {
    if (!['property', 'user'].includes(type))
      throw new BadRequestException('Unknown report target');
    const where = {
      status: 'open',
      ...(type === 'property' ? { propertyId: id } : { reportedUserId: id }),
    };
    const [rows, count] = await Promise.all([
      this.prisma.report.findMany({
        where: { ...where, ...this.search(query.q) },
        select: {
          id: true,
          reason: true,
          details: true,
          createdAt: true,
          reporter: { select: PERSON },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: query.offset,
        take: 51,
      }),
      this.prisma.report.count({ where }),
    ]);
    // The database allows one open report per reporter and target.
    return {
      items: rows.slice(0, 50),
      reportCount: count,
      reporterCount: count,
      nextOffset: rows.length > 50 ? query.offset + 50 : null,
    };
  }
  private search(query?: string) {
    const q = query?.trim();
    return q
      ? {
          OR: [
            { reason: { contains: q, mode: 'insensitive' as const } },
            { details: { contains: q, mode: 'insensitive' as const } },
            {
              reporter: {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  { username: { contains: q, mode: 'insensitive' as const } },
                ],
              },
            },
          ],
        }
      : {};
  }
}
