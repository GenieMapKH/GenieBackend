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
import { AdminIncomeService } from './admin-income.service';

@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/admin/dashboard', version: VERSION_NEUTRAL })
export class InternalAdminDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly records: AdminPaymentRecordsService,
    private readonly income: AdminIncomeService,
  ) {}

  @Get('records')
  list(
    @Query('section') section: string,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('tier') tier?: string,
    @Query('q') q?: string,
    @Query('purpose') purpose?: string,
  ) {
    return this.records.list(section, offset, tier, q, purpose);
  }

  @Get()
  async overview() {
    const now = new Date();
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
        this.income.summary(now),
      ]);
    return {
      activeSubscriptions,
      subscriptionsByTier: Object.fromEntries(
        tiers.map(({ tier, _count }) => [tier, _count._all]),
      ),
      pendingTransactions,
      ...settled,
      simulated: this.provider.name === 'MOCK',
    };
  }
}
