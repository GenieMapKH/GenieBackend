import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisConnection } from '@tilomnov/shared';

type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
};

@Injectable()
export class AdminRotationJobService {
  constructor(private readonly redis: RedisConnection) {}

  private config() {
    const repository = process.env.ADMIN_ROTATION_GITHUB_REPOSITORY;
    const token = process.env.ADMIN_ROTATION_GITHUB_TOKEN;
    const ref = process.env.ADMIN_ROTATION_GITHUB_REF;
    return repository && /^[\w.-]+\/[\w.-]+$/.test(repository) && token && ref
      ? { repository, token, ref }
      : null;
  }

  private async request(path: string, body?: unknown) {
    const config = this.config();
    if (!config)
      throw new ServiceUnavailableException(
        'Credential rotation is not connected',
      );
    try {
      const response = await fetch(
        `https://api.github.com/repos/${config.repository}/actions/workflows/secret-rotation.yml/${path}`,
        {
          method: body ? 'POST' : 'GET',
          headers: {
            authorization: `Bearer ${config.token}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'x-github-api-version': '2026-03-10',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('GitHub request failed');
      return response.status === 204
        ? {}
        : ((await response.json()) as Record<string, unknown>);
    } catch {
      throw new ServiceUnavailableException(
        'Could not confirm the rotation request. Refresh workflow status before trying again.',
      );
    }
  }

  async status() {
    const config = this.config();
    if (!config) return { status: 'not_configured', runs: [], busy: false };
    const body = await this.request(
      `runs?per_page=10&branch=${encodeURIComponent(config.ref)}`,
    );
    const runs = (body.workflow_runs as WorkflowRun[]).map((run) => ({
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      url: `https://github.com/${config.repository}/actions/runs/${run.id}`,
    }));
    const busy =
      runs.some((run) => run.status !== 'completed') ||
      Boolean(await this.redis.client.exists('admin:rotation:dispatch'));
    return { status: 'ok', runs, busy };
  }

  async force() {
    const config = this.config();
    if (!config)
      throw new ServiceUnavailableException(
        'Credential rotation is not connected',
      );
    if ((await this.status()).busy)
      throw new ConflictException('A rotation is already queued or running');
    const locked = await this.redis.client.set(
      'admin:production:operation',
      'rotation',
      'EX',
      120,
      'NX',
    );
    if (!locked)
      throw new ConflictException(
        'An operation was just requested. Refresh its status.',
      );
    await this.redis.client.set(
      'admin:rotation:dispatch',
      'requested',
      'EX',
      120,
    );
    const body = await this.request('dispatches', {
      ref: config.ref,
      inputs: { force: true, dry_run: false, only: '', bootstrap: true },
    });
    return { status: 'accepted', runId: body.workflow_run_id ?? null };
  }
}
