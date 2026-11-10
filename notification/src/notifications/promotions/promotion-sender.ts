import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PushDeliveryService } from '../delivery/push-delivery.service';
import { PushSender } from '../delivery/push-sender';
import { PushDevicesService } from '../devices/push-devices.service';
import { promotionPush } from './promotion.push';

/**
 * Sends a promotion to every device whose owner allows promotions, a page
 * at a time, and keeps its counts up to date.
 *
 * A promotion is claimed by moving it from 'queued' to 'sending' in one
 * statement, so two instances (or a repeated start) never send it twice.
 * One left 'queued' by a restart is picked up when the service starts again.
 */
@Injectable()
export class PromotionSender implements OnApplicationBootstrap {
  private readonly logger = new Logger(PromotionSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: PushDevicesService,
    private readonly delivery: PushDeliveryService,
  ) {}

  onApplicationBootstrap() {
    void this.resumeQueued();
  }

  /** Returns at once: sending a large audience takes a while. */
  startInBackground(promotionId: string): void {
    this.send(promotionId).catch((error: Error) =>
      this.logger.error(`Promotion ${promotionId} stopped: ${error.message}`),
    );
  }

  /** Sends [promotionId] if nobody has started it yet. */
  async send(promotionId: string): Promise<void> {
    const claimed = await this.prisma.promotion.updateMany({
      where: { id: promotionId, status: 'queued' },
      data: { status: 'sending', startedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const promotion = await this.prisma.promotion.findUniqueOrThrow({
      where: { id: promotionId },
    });
    let sent = 0;
    let failed = 0;
    try {
      for await (const page of this.devices.promotionAudience(
        PushSender.maxBatch,
      )) {
        const report = await this.delivery.deliver(page, (target) =>
          promotionPush(promotion, target),
        );
        sent += report.sent;
        failed += report.failed;
        await this.prisma.promotion.update({
          where: { id: promotionId },
          data: { sentCount: sent, failedCount: failed },
        });
      }
      await this.finish(promotionId, 'sent');
      this.logger.log(
        `Promotion ${promotionId}: ${sent} sent, ${failed} failed`,
      );
    } catch (error) {
      await this.finish(promotionId, 'failed');
      throw error;
    }
  }

  private async finish(
    promotionId: string,
    status: 'sent' | 'failed',
  ): Promise<void> {
    await this.prisma.promotion.update({
      where: { id: promotionId },
      data: { status, finishedAt: new Date() },
    });
  }

  private async resumeQueued(): Promise<void> {
    try {
      const queued = await this.prisma.promotion.findMany({
        where: { status: 'queued' },
        select: { id: true },
      });
      for (const { id } of queued) this.startInBackground(id);
    } catch (error) {
      this.logger.error(
        `Queued promotions not resumed: ${(error as Error).message}`,
      );
    }
  }
}
