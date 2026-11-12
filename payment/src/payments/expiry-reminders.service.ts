import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ExpiryReminderDto,
  MessageBus,
  PrismaService,
  ServiceClient,
} from '@tilomnov/shared';
import type { PaymentTransaction, Subscription } from '@tilomnov/prisma-client';

/** One reminder per purchased period, starting three days before expiry. */
@Injectable()
export class ExpiryRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryRemindersService.name);
  private readonly notification = new ServiceClient(
    'notification',
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4006',
    'payment',
  );
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageBus,
  ) {}

  onModuleInit() {
    void this.run();
  }

  /** A queued reminder can arrive after renewal, so delivery checks the current ledger. */
  async isCurrent(event: ExpiryReminderDto): Promise<boolean> {
    const end = new Date(event.expiresAt);
    if (end <= new Date()) return false;
    if (event.kind === 'subscription') {
      return !!(await this.prisma.subscription.findFirst({
        where: { userId: event.userId, currentPeriodEnd: end },
      }));
    }
    const [paid, covered, renewed] = await Promise.all([
      this.prisma.paymentTransaction.findFirst({
        where: {
          userId: event.userId,
          propertyId: event.propertyId,
          purpose: 'LISTING_PUBLISH',
          status: 'Success',
          listingPeriodEnd: end,
        },
      }),
      this.prisma.subscription.findFirst({
        where: { userId: event.userId, currentPeriodEnd: { gt: end } },
      }),
      this.prisma.paymentTransaction.findFirst({
        where: {
          userId: event.userId,
          propertyId: event.propertyId,
          purpose: 'LISTING_PUBLISH',
          status: 'Success',
          listingPeriodEnd: { gt: end },
        },
      }),
    ]);
    return !!paid && !covered && !renewed;
  }
  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async run() {
    try {
      await this.scan();
    } catch (error) {
      this.logger.error(`Expiry reminders failed: ${(error as Error).message}`);
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.run(), 60_000);
        this.timer.unref();
      }
    }
  }

  async scan(now = new Date()) {
    const period = { gt: now, lte: new Date(now.getTime() + 3 * 86400000) };
    let subscriptionAfter: string | undefined;
    let listingAfter: string | undefined;
    let subscriptionsDone = false;
    let listingsDone = false;
    do {
      const [subscriptions, listings]: [Subscription[], PaymentTransaction[]] =
        await Promise.all([
          subscriptionsDone
            ? Promise.resolve<Subscription[]>([])
            : this.prisma.subscription.findMany({
                where: {
                  currentPeriodEnd: period,
                  expiryReminderSentAt: null,
                  ...(subscriptionAfter && {
                    userId: { gt: subscriptionAfter },
                  }),
                },
                take: 100,
                orderBy: { userId: 'asc' },
              }),
          listingsDone
            ? Promise.resolve<PaymentTransaction[]>([])
            : this.prisma.paymentTransaction.findMany({
                where: {
                  purpose: 'LISTING_PUBLISH',
                  status: 'Success',
                  userId: { not: null },
                  propertyId: { not: null },
                  listingPeriodEnd: period,
                  expiryReminderSentAt: null,
                  ...(listingAfter && { id: { gt: listingAfter } }),
                },
                take: 100,
                orderBy: { id: 'asc' },
              }),
        ]);
      subscriptionAfter = subscriptions[subscriptions.length - 1]?.userId;
      listingAfter = listings[listings.length - 1]?.id;
      subscriptionsDone = subscriptions.length < 100;
      listingsDone = listings.length < 100;
      const due = [
        ...subscriptions.map((row) => ({
          kind: 'subscription' as const,
          id: row.userId,
          userId: row.userId,
          propertyId: null,
          expiresAt: row.currentPeriodEnd,
          tier: row.tier,
        })),
        ...listings.map((row) => ({
          kind: 'listing' as const,
          id: row.id,
          userId: row.userId!,
          propertyId: row.propertyId!,
          expiresAt: row.listingPeriodEnd!,
          tier: null,
        })),
      ];
      for (const row of due) {
        if (this.stopped) return;
        try {
          await this.prisma.$transaction(
            async (tx) => {
              const [lock] = await tx.$queryRaw<
                { locked: boolean }[]
              >`SELECT pg_try_advisory_xact_lock(hashtextextended(${row.userId}, 1)) AS locked`;
              if (!lock.locked) return;
              const current =
                row.kind === 'subscription'
                  ? await tx.subscription.findFirst({
                      where: {
                        userId: row.userId,
                        currentPeriodEnd: row.expiresAt,
                        expiryReminderSentAt: null,
                      },
                    })
                  : await tx.paymentTransaction.findFirst({
                      where: {
                        id: row.id,
                        userId: row.userId,
                        propertyId: row.propertyId,
                        status: 'Success',
                        listingPeriodEnd: row.expiresAt,
                        expiryReminderSentAt: null,
                      },
                    });
              if (!current || row.expiresAt <= new Date()) return;
              const markSent = () =>
                row.kind === 'subscription'
                  ? tx.subscription.update({
                      where: { userId: row.userId },
                      data: { expiryReminderSentAt: new Date() },
                    })
                  : tx.paymentTransaction.update({
                      where: { id: row.id },
                      data: { expiryReminderSentAt: new Date() },
                    });
              if (row.kind === 'listing') {
                const covered = await tx.subscription.findFirst({
                  where: {
                    userId: row.userId,
                    currentPeriodEnd: { gt: row.expiresAt },
                  },
                });
                const renewed = await tx.paymentTransaction.findFirst({
                  where: {
                    userId: row.userId,
                    propertyId: row.propertyId,
                    status: 'Success',
                    listingPeriodEnd: { gt: row.expiresAt },
                  },
                });
                if (covered || renewed) {
                  await markSent();
                  return;
                }
              }
              const body = {
                userId: row.userId,
                kind: row.kind,
                expiresAt: row.expiresAt.toISOString(),
                ...(row.propertyId && { propertyId: row.propertyId }),
                ...(row.tier && { tier: row.tier }),
              };
              if (this.messages.enabled) {
                await this.messages.enqueue(
                  'notification.publishing-expiry.v1',
                  body,
                  {
                    key: `expiry:${row.kind}:${row.id}:${row.expiresAt.toISOString()}`,
                    expiresAt: row.expiresAt,
                    tx,
                  },
                );
                await markSent();
                return;
              }
              const report = await this.notification.call<{
                failed: number;
                removed: number;
              }>('POST', '/internal/notifications/publishing-expiry', {
                body,
                timeoutMs: 5000,
              });
              if (report.failed > report.removed)
                throw new Error('Reminder delivery failed');
              await markSent();
            },
            { timeout: 10_000 },
          );
        } catch (error) {
          this.logger.warn(
            `Reminder ${row.id} will retry: ${(error as Error).message}`,
          );
        }
      }
    } while (!this.stopped && (!subscriptionsDone || !listingsDone));
  }
}
