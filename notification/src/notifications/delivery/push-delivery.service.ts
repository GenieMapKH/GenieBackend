import { Injectable, Logger } from '@nestjs/common';
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
  ) {}

  /** [contentFor] writes each device's push (in its language); null skips the device. */
  async deliver(
    targets: PushTarget[],
    contentFor: (target: PushTarget) => PushContent | null,
  ): Promise<DeliveryReport> {
    const report: DeliveryReport = { sent: 0, failed: 0, removed: 0 };
    const gone: string[] = [];

    for (let start = 0; start < targets.length; start += PushSender.maxBatch) {
      const batch = targets
        .slice(start, start + PushSender.maxBatch)
        .flatMap((target) => {
          const content = contentFor(target);
          return content ? [{ target, content }] : [];
        });
      if (batch.length === 0) continue;

      const outcomes = await this.sendBatch(batch);
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
      return await this.sender.send(
        batch.map(({ target, content }) => ({
          token: target.token,
          platform: target.platform,
          content,
        })),
      );
    } catch (error) {
      this.logger.error(
        `A batch of ${batch.length} pushes failed: ${(error as Error).message}`,
      );
      return batch.map(() => 'failed');
    }
  }
}
