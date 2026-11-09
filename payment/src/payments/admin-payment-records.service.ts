import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PLANS } from './plan-catalog';

@Injectable()
export class AdminPaymentRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(section: string, offset: number, tier?: string) {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new BadRequestException('Invalid page offset');
    if (tier && (!Object.keys(PLANS).includes(tier) || tier === 'free'))
      throw new BadRequestException('Invalid subscription tier');
    if (section === 'subscriptions') {
      const rows = await this.prisma.subscription.findMany({
        where: { currentPeriodEnd: { gt: new Date() }, ...(tier && { tier }) },
        select: {
          userId: true,
          tier: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          cancelledAt: true,
          transactionId: true,
        },
        orderBy: [{ currentPeriodEnd: 'desc' }, { userId: 'asc' }],
        skip: offset,
        take: 51,
      });
      return this.page(rows, offset);
    }
    if (!['successful-payments', 'pending-payments'].includes(section))
      throw new BadRequestException('Invalid payment section');
    const rows = await this.prisma.paymentTransaction.findMany({
      where:
        section === 'pending-payments'
          ? { status: 'Pending' }
          : {
              status: 'Success',
              paidAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
      select: {
        id: true,
        userId: true,
        propertyId: true,
        purpose: true,
        subscriptionTier: true,
        amount: true,
        currency: true,
        status: true,
        provider: true,
        paymentMethod: true,
        createdAt: true,
        paidAt: true,
        subscriptionPeriodStart: true,
        subscriptionPeriodEnd: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: 51,
    });
    return this.page(rows, offset);
  }

  private page<T>(rows: T[], offset: number) {
    return {
      items: rows.slice(0, 50),
      nextOffset: rows.length > 50 ? offset + 50 : null,
    };
  }
}
