/** What Meilisearch answers when it accepts a write: the task that will carry it out. */
interface EnqueuedTask {
  taskUid: number;
}

interface Task {
  status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  error?: { message: string; code: string } | null;
}

/** A request Meilisearch refused or could not answer. */
export class MeilisearchError extends Error {
  constructor(
    message: string,
    /** Meilisearch's error code, e.g. `index_not_found`; none for a network failure. */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The longest a search may take before the database answers instead. */
const SEARCH_TIMEOUT_MS = 1_500;
const WRITE_TIMEOUT_MS = 10_000;

/** How long a full reindex waits for one task, and how often it looks. */
const TASK_TIMEOUT_MS = 10 * 60_000;
const TASK_POLL_MS = 250;

/**
 * The few calls of Meilisearch's HTTP API this service uses
 * (https://www.meilisearch.com/docs/reference/api/overview). Writes are
 * queued as tasks on the server; `waitFor` follows one to its end.
 */
export class MeilisearchClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
  ) {}

  /** Ids of the documents of `index` matching `query`, best first. */
  async searchIds(
    index: string,
    query: string,
    limit: number,
  ): Promise<string[]> {
    const result = await this.request<{ hits: { id: string }[] }>(
      'POST',
      `/indexes/${index}/search`,
      // Every word must match, as before, and only ids come back.
      {
        q: query,
        limit,
        matchingStrategy: 'all',
        attributesToRetrieve: ['id'],
      },
      SEARCH_TIMEOUT_MS,
    );
    return result.hits.map((hit) => hit.id);
  }

  addDocuments(index: string, documents: object[]): Promise<EnqueuedTask> {
    return this.request(
      'POST',
      `/indexes/${index}/documents?primaryKey=id`,
      documents,
    );
  }

  deleteDocument(index: string, id: string): Promise<EnqueuedTask> {
    return this.request(
      'DELETE',
      `/indexes/${index}/documents/${encodeURIComponent(id)}`,
    );
  }

  createIndex(index: string): Promise<EnqueuedTask> {
    return this.request('POST', '/indexes', { uid: index, primaryKey: 'id' });
  }

  deleteIndex(index: string): Promise<EnqueuedTask> {
    return this.request('DELETE', `/indexes/${index}`);
  }

  updateSettings(index: string, settings: object): Promise<EnqueuedTask> {
    return this.request('PATCH', `/indexes/${index}/settings`, settings);
  }

  /** Each index of a pair takes the other's place, both at once. */
  swapIndexes(pairs: [string, string][]): Promise<EnqueuedTask> {
    return this.request(
      'POST',
      '/swap-indexes',
      pairs.map((indexes) => ({ indexes })),
    );
  }

  /** How many documents `index` holds; null when it does not exist. */
  async documentCount(index: string): Promise<number | null> {
    try {
      const stats = await this.request<{ numberOfDocuments: number }>(
        'GET',
        `/indexes/${index}/stats`,
      );
      return stats.numberOfDocuments;
    } catch (error) {
      if (error instanceof MeilisearchError && error.code === 'index_not_found')
        return null;
      throw error;
    }
  }

  /** Waits for `task` to end; throws when it failed, or with `failureAllowed` returns quietly. */
  async waitFor(
    task: EnqueuedTask,
    failureAllowed?: (code: string) => boolean,
  ): Promise<void> {
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    for (;;) {
      const state = await this.request<Task>('GET', `/tasks/${task.taskUid}`);
      if (state.status === 'succeeded') return;
      if (state.status === 'failed' || state.status === 'canceled') {
        const code = state.error?.code ?? state.status;
        if (failureAllowed?.(code)) return;
        throw new MeilisearchError(
          `Task ${task.taskUid} ${state.status}: ${state.error?.message ?? ''}`,
          code,
        );
      }
      if (Date.now() > deadline)
        throw new MeilisearchError(
          `Task ${task.taskUid} did not finish in time`,
        );
      await new Promise((resolve) => setTimeout(resolve, TASK_POLL_MS));
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = WRITE_TIMEOUT_MS,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new MeilisearchError(
        `${method} ${path} failed: ${(error as Error).message}`,
      );
    }
    const answer = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      code?: string;
    };
    if (!response.ok) {
      throw new MeilisearchError(
        `${method} ${path}: ${response.status} ${answer.message ?? ''}`,
        answer.code,
      );
    }
    return answer;
  }
}
