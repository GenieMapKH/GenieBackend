import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService, signServiceToken } from '@tilomnov/shared';

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      totalUsers,
      activeUsers,
      newUsers7d,
      openReports,
      listings,
      payments,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'user' } }),
      this.prisma.user.count({ where: { role: 'user', deactivatedAt: null } }),
      this.prisma.user.count({
        where: { role: 'user', createdAt: { gte: since } },
      }),
      this.prisma.report.count({ where: { status: 'open' } }),
      this.internalGet('property', 'PROPERTY_SERVICE_URL', 4003),
      this.internalGet('payment', 'PAYMENT_SERVICE_URL', 4005),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      periodDays: 7,
      users: {
        total: totalUsers,
        active: activeUsers,
        newLast7Days: newUsers7d,
      },
      openReports,
      listings,
      payments,
    };
  }

  async internalGet<T>(
    service: 'property' | 'payment',
    env: string,
    port: number,
    path = '',
  ): Promise<T> {
    const base = (process.env[env] || `http://localhost:${port}`).replace(
      /\/$/,
      '',
    );
    try {
      const response = await fetch(`${base}/internal/admin/dashboard${path}`, {
        headers: { authorization: `Bearer ${signServiceToken('user')}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      this.logger.error(
        `${service} dashboard metrics unavailable: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Dashboard metrics are temporarily unavailable',
      );
    }
  }
}
