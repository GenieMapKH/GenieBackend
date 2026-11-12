import { Injectable, Logger } from '@nestjs/common';
import { currentServiceMessage, PrismaService } from '@tilomnov/shared';
import { PushDevicesService } from '../devices/push-devices.service';
import {
  PushContent,
  PushOutcome,
  PushSender,
  PushTarget,
} from './push-sender';

/** How a delivery went, for logs and for a promotion's counts. */
export interface DeliveryReport {
  sent: number;
  failed: number;
  /** Devices forgotten because their token no longer reaches them. */
  removed: number;
}

/**
 * Sends one push per device, in batches the provider accepts, and forgets
 * the devices whose token the provider says is gone (app uninstalled, token
 * replaced).
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(
    private readonly sender: PushSender,
    private readonly devices: PushDevicesService,
    private readonly prisma?: PrismaService,
  ) {}

  /** [contentFor] writes each device's push (in its language); null skips the device. */
  async deliver(
    targets: PushTarget[],
    contentFor: (target: PushTarget) => PushContent | null,
  ): Promise<DeliveryReport> {
    const report: DeliveryReport = { sent: 0, failed: 0, removed: 0 };
    const gone: string[] = [];
    const message = currentServiceMessage();
    const receipts =
      message && this.prisma
        ? await this.prisma.$queryRaw<{ step: string }[]>`
          SELECT step FROM notification.service_message_receipts
          WHERE service = 'notification' AND event_id = ${message.id}::uuid AND step <> ''`
        : [];
    const sentSteps = new Set(receipts.map((row) => row.step));

    for (let start = 0; start < targets.length; start += PushSender.maxBatch) {
      const batch = targets
        .slice(start, start + PushSender.maxBatch)
        .flatMap((target) => {
          const content = contentFor(target);
          return content && !sentSteps.has(`push:${target.id}`)
            ? [{ target, content }]
            : [];
        });
      if (batch.length === 0) continue;

      const outcomes = await this.sendBatch(batch);
      const completed = batch.flatMap(({ target }, index) =>
        outcomes[index] === 'sent' || outcomes[index] === 'unregistered'
          ? [`push:${target.id}`]
          : [],
      );
      if (message && this.prisma && completed.length > 0) {
        await this.prisma.$executeRaw`
          INSERT INTO notification.service_message_receipts (service, event_id, step)
          SELECT 'notification', ${message.id}::uuid, unnest(${completed}::text[])
          ON CONFLICT DO NOTHING`;
      }
      outcomes.forEach((outcome, index) => {
        if (outcome === 'sent') {
          report.sent++;
          return;
        }
        report.failed++;
        if (outcome === 'unregistered') gone.push(batch[index].target.id);
      });
    }

    if (gone.length > 0) {
      report.removed = await this.devices.forget(gone);
    }
    return report;
  }

  /** A provider outage fails the batch; it does not stop the next one. */
  private async sendBatch(
    batch: { target: PushTarget; content: PushContent }[],
  ): Promise<PushOutcome[]> {
    try {
      const outcomes = await this.sender.send(
        batch.map(({ target, content }) => ({
          token: target.token,
          platform: target.platform,
          content,
        })),
      );
      if (outcomes.length !== batch.length)
        throw new Error('Incomplete push provider response');
      return outcomes;
    } catch (error) {
      this.logger.error(
        `A batch of ${batch.length} pushes failed: ${(error as Error).message}`,
      );
      return batch.map(() => 'failed');
    }
  }
}
