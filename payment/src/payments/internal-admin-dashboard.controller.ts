import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService, serviceCallGuard } from '@tilomnov/shared';
import { PaymentProvider } from './payment-provider.interface';
import { AdminPaymentRecordsService } from './admin-payment-records.service';

@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/admin/dashboard', version: VERSION_NEUTRAL })
export class InternalAdminDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly records: AdminPaymentRecordsService,
  ) {}

  @Get('records')
  list(
    @Query('section') section: string,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('tier') tier?: string,
  ) {
    return this.records.list(section, offset, tier);
  }

  @Get()
  async overview() {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [activeSubscriptions, tiers, pendingTransactions, settled] =
      await Promise.all([
        this.prisma.subscription.count({
          where: { currentPeriodEnd: { gt: now } },
        }),
        this.prisma.subscription.groupBy({
          by: ['tier'],
          where: { currentPeriodEnd: { gt: now } },
          _count: { _all: true },
        }),
        this.prisma.paymentTransaction.count({ where: { status: 'Pending' } }),
        this.prisma.paymentTransaction.aggregate({
          where: { status: 'Success', paidAt: { gte: since } },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);
    return {
      activeSubscriptions,
      subscriptionsByTier: Object.fromEntries(
        tiers.map(({ tier, _count }) => [tier, _count._all]),
      ),
      pendingTransactions,
      successfulTransactions7d: settled._count._all,
      volumeUsd7d: Number(settled._sum.amount ?? 0),
      simulated: this.provider.name === 'MOCK',
    };
  }
}
