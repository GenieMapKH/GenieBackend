import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SearchEngine } from './search-engine';
import { SearchIndexSync } from './search-index-sync.service';

/** 20:00 UTC is 03:00 in Cambodia: the quietest hour to rebuild the index. */
const REINDEX_HOUR_UTC = 20;

/** Milliseconds from `now` until the next `hourUtc` o'clock. */
export function msUntilHour(now: Date, hourUtc: number): number {
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Sets the search index up when the service starts (filling it when it is
 * empty, as on its first deploy) and rebuilds it every night, which repairs
 * any change the engine missed. Every instance does this; a rebuild is
 * complete by itself, so two at once only cost time.
 */
@Injectable()
export class SearchReindexSchedule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SearchReindexSchedule.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly engine: SearchEngine,
    private readonly sync: SearchIndexSync,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.engine.isConfigured) {
      this.logger.log(
        'No search engine is configured: search reads the database',
      );
      return;
    }
    void this.prepare();
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
  }

  /** Rebuilds the index unless a rebuild is already running here. */
  async reindex(reason: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    try {
      await this.sync.reindexAll();
      this.logger.log(
        `Search index rebuilt (${reason}) in ${Date.now() - started} ms`,
      );
    } catch (error) {
      this.logger.error(
        `Rebuilding the search index failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async prepare(): Promise<void> {
    try {
      await this.engine.prepare();
      if (await this.engine.isEmpty())
        await this.reindex('the index was empty');
    } catch (error) {
      // Search keeps working from the database; the nightly rebuild retries.
      this.logger.error(
        `The search engine could not be set up: ${(error as Error).message}`,
      );
    }
  }

  private scheduleNext(): void {
    this.timer = setTimeout(
      () => {
        void this.reindex('nightly').finally(() => this.scheduleNext());
      },
      msUntilHour(new Date(), REINDEX_HOUR_UTC),
    );
    this.timer.unref();
  }
}
