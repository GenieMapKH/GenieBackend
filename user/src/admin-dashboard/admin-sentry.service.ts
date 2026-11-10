import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminLogsQuery {
  @IsIn(['logs', 'errors']) dataset: 'logs' | 'errors' = 'logs';
  @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
}

@Injectable()
export class AdminSentryService {
  async logs(query: AdminLogsQuery) {
    const token = process.env.ADMIN_SENTRY_TOKEN;
    const organization = process.env.ADMIN_SENTRY_ORGANIZATION;
    const environment = process.env.ADMIN_SENTRY_ENVIRONMENT;
    const projects = process.env.ADMIN_SENTRY_PROJECT_IDS?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const checkedAt = new Date().toISOString();
    if (!token || !organization || !environment || !projects?.length)
      return {
        status: 'not_configured',
        checkedAt,
        environment: null,
        entries: [],
        nextCursor: null,
      };
    try {
      const base = (
        process.env.ADMIN_SENTRY_URL || 'https://sentry.io'
      ).replace(/\/+$/, '');
      const url = new URL(
        `${base}/api/0/organizations/${encodeURIComponent(organization)}/events/`,
      );
      const level = query.dataset === 'logs' ? 'severity' : 'level';
      const message = query.dataset === 'logs' ? 'message' : 'title';
      for (const field of ['id', 'timestamp', 'project.name', level, message])
        url.searchParams.append('field', field);
      for (const project of projects)
        url.searchParams.append('project', project);
      for (const [key, value] of Object.entries({
        dataset: query.dataset,
        environment,
        statsPeriod: '24h',
        per_page: '100',
        sort: '-timestamp',
        ...(query.cursor ? { cursor: query.cursor } : {}),
      }))
        url.searchParams.set(key, value);
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Sentry request failed');
      const body = (await response.json()) as {
        data: Record<string, unknown>[];
      };
      const entries = body.data.map((row) => {
        if (
          typeof row.id !== 'string' ||
          typeof row.timestamp !== 'string' ||
          !Number.isFinite(Date.parse(row.timestamp))
        )
          throw new Error('Invalid Sentry event');
        const project =
          typeof row['project.name'] === 'string' ? row['project.name'] : '';
        const severity = row[level];
        const text = row[message];
        return {
          id: `${project}:${row.id}`,
          timestamp: new Date(row.timestamp).toISOString(),
          project,
          level: typeof severity === 'string' ? severity : 'info',
          message: typeof text === 'string' ? text.slice(0, 10000) : '',
        };
      });
      const nextLink = response.headers
        .get('link')
        ?.split(',')
        .find((link) => /rel="next"/.test(link) && /results="true"/.test(link));
      const nextUrl = nextLink?.match(/<([^>]+)>/)?.[1];
      const nextCursor = nextUrl
        ? new URL(nextUrl).searchParams.get('cursor')
        : null;
      return { status: 'ok', checkedAt, environment, entries, nextCursor };
    } catch {
      throw new ServiceUnavailableException(
        'Sentry logs could not be loaded. Try again shortly.',
      );
    }
  }
}
