import { ValidationPipe } from '@nestjs/common';
import {
  AdminPropertiesController,
  AdminAccountActionsController,
} from './admin-properties.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminAdvertisementsController } from './admin-advertisements.controller';
import { AdminPlatformService } from './admin-platform.service';
import { AdminReportsService } from './admin-reports.service';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminGuard, PrismaService, RedisConnection } from '@tilomnov/shared';
import { fakeAuthKeys, FakeAuthKeys } from '@tilomnov/shared/testing';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRecordsService } from './admin-records.service';
import { AdminSystemHealthService } from './admin-system-health.service';
import { AdminRotationService } from './admin-rotation.service';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminRotationJobService } from './admin-rotation-job.service';
import { AdminSentryService } from './admin-sentry.service';
import { AdminDeploymentsService } from './admin-deployments.service';

describe('admin routes over HTTP', () => {
  let app: INestApplication;
  let base: string;
  let keys: FakeAuthKeys;
  const user = { findFirst: jest.fn() };
  const redis = { client: { exists: jest.fn() } };
  const dashboard = { overview: jest.fn() };
  const records = { list: jest.fn() };
  const health = { check: jest.fn() };
  const rotation = { status: jest.fn() };
  const rotationJob = { status: jest.fn(), force: jest.fn() };
  const sentry = { logs: jest.fn() };
  const deployments = { status: jest.fn(), rollback: jest.fn() };
  const platform = {
    property: jest.fn(),
    mutate: jest.fn(),
    account: jest.fn(),
  };
  const reportGroups = { groups: jest.fn(), detail: jest.fn() };
  beforeAll(async () => {
    keys = fakeAuthKeys();
    const module = await Test.createTestingModule({
      controllers: [
        AdminOperationsController,
        AdminDashboardController,
        AdminPropertiesController,
        AdminAccountActionsController,
        AdminReportsController,
        AdminAdvertisementsController,
      ],
      providers: [
        AdminGuard,
        { provide: AdminPlatformService, useValue: platform },
        { provide: AdminReportsService, useValue: reportGroups },
        { provide: PrismaService, useValue: { user } },
        { provide: RedisConnection, useValue: redis },
        { provide: AdminDashboardService, useValue: dashboard },
        { provide: AdminRecordsService, useValue: records },
        { provide: AdminSystemHealthService, useValue: health },
        { provide: AdminRotationService, useValue: rotation },
        { provide: AdminRotationJobService, useValue: rotationJob },
        { provide: AdminSentryService, useValue: sentry },
        { provide: AdminDeploymentsService, useValue: deployments },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    keys?.restore();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    user.findFirst.mockResolvedValue({ role: 'admin' });
    redis.client.exists.mockResolvedValue(0);
    dashboard.overview.mockResolvedValue({ protected: true });
    records.list.mockResolvedValue({ items: [], nextOffset: null });
    health.check.mockResolvedValue({ services: [] });
    rotation.status.mockResolvedValue({ credentials: [] });
    rotationJob.status.mockResolvedValue({
      status: 'ok',
      runs: [],
      busy: false,
    });
    sentry.logs.mockResolvedValue({ entries: [] });
    deployments.status.mockResolvedValue({ services: [] });
    platform.mutate.mockImplementation(
      (_actor, _id, _action, _reason, work: () => Promise<unknown>) => work(),
    );
  });
  const claims = {
    typ: 'access',
    role: 'admin',
    adminMfa: true,
    sid: 'owner-device',
  };
  for (const path of [
    '/admin/dashboard',
    '/admin/dashboard/records?section=active-users',
    '/admin/dashboard/health',
    '/admin/dashboard/rotations',
    '/admin/operations/rotation-job',
    '/admin/operations/logs',
    '/admin/operations/deployments',
  ]) {
    it.each([
      'anonymous',
      'headers-only',
      'regular-user',
      'password-only',
      'expired',
      'revoked',
      'demoted',
      'deactivated',
    ])(`protects ${path} from %s callers`, async (caller) => {
      const headers: Record<string, string> = {
        'x-user-id': 'owner',
        'x-user-role': 'admin',
        'x-admin-mfa': 'true',
      };
      if (!['anonymous', 'headers-only'].includes(caller)) {
        headers.authorization = `Bearer ${keys.sign(
          {
            ...claims,
            ...(caller === 'regular-user' && { role: 'user' }),
            ...(caller === 'password-only' && { adminMfa: false }),
          },
          caller === 'expired' ? { expiresIn: -1 } : {},
        )}`;
      }
      if (caller === 'revoked') redis.client.exists.mockResolvedValue(1);
      if (caller === 'demoted')
        user.findFirst.mockResolvedValue({ role: 'user' });
      if (caller === 'deactivated') user.findFirst.mockResolvedValue(null);
      const response = await fetch(`${base}${path}`, { headers });
      expect([401, 403]).toContain(response.status);
      expect(dashboard.overview).not.toHaveBeenCalled();
      expect(records.list).not.toHaveBeenCalled();
      expect(health.check).not.toHaveBeenCalled();
      expect(rotation.status).not.toHaveBeenCalled();
      expect(rotationJob.status).not.toHaveBeenCalled();
      expect(sentry.logs).not.toHaveBeenCalled();
      expect(deployments.status).not.toHaveBeenCalled();
    });
    it(`allows a verified, active administrator on ${path}`, async () => {
      const response = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${keys.sign(claims)}` },
      });
      expect(response.status).toBe(200);
    });
  }
  const target = '00000000-0000-4000-8000-000000000001';
  it('validates operations input before auditing or calling providers', async () => {
    const headers = {
      authorization: `Bearer ${keys.sign(claims)}`,
      'content-type': 'application/json',
    };
    const responses = await Promise.all([
      fetch(`${base}/admin/operations/rotation-job`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: ' ' }),
      }),
      fetch(`${base}/admin/operations/deployments/user/rollback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          reason: 'Recover',
          deploymentId: 'bad-id',
          expectedLatestId: target,
        }),
      }),
      fetch(`${base}/admin/operations/logs?dataset=secrets`, { headers }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      400, 400, 400,
    ]);
    expect(platform.mutate).not.toHaveBeenCalled();
    expect(rotationJob.force).not.toHaveBeenCalled();
    expect(deployments.rollback).not.toHaveBeenCalled();
    expect(sentry.logs).not.toHaveBeenCalled();
  });
  it('audits a force rotation using the verified actor', async () => {
    const response = await fetch(`${base}/admin/operations/rotation-job`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${keys.sign(claims)}`,
        'content-type': 'application/json',
        'x-user-id': 'forged',
      },
      body: JSON.stringify({ reason: 'Routine rotation' }),
    });
    expect(response.status).toBe(201);
    expect(platform.mutate).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      'credentials.rotate-all.request',
      'Routine rotation',
      expect.any(Function),
    );
    expect(rotationJob.force).toHaveBeenCalledTimes(1);
  });
  it('blocks rollback while rotation is running', async () => {
    rotationJob.status.mockResolvedValue({
      status: 'ok',
      busy: true,
      runs: [],
    });
    const response = await fetch(
      `${base}/admin/operations/deployments/user/rollback`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${keys.sign(claims)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Recovery',
          deploymentId: target,
          expectedLatestId: target,
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(platform.mutate).not.toHaveBeenCalled();
    expect(deployments.rollback).not.toHaveBeenCalled();
  });
  it('uses the verified administrator as actor and strips forged client identity headers on mutations', async () => {
    const response = await fetch(`${base}/admin/users/${target}/ban`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${keys.sign(claims)}`,
        'content-type': 'application/json',
        'x-user-id': 'forged-actor',
      },
      body: JSON.stringify({ reason: 'Fraudulent listings' }),
    });
    expect(response.status).toBe(201);
    expect(platform.account).toHaveBeenCalledWith(
      'user-1',
      target,
      'ban',
      'Fraudulent listings',
    );
  });
  for (const [method, path] of [
    ['POST', '/admin/operations/rotation-job'],
    ['POST', '/admin/operations/deployments/user/rollback'],
    ['GET', `/admin/properties/${target}`],
    ['PATCH', `/admin/properties/${target}`],
    ['POST', `/admin/properties/${target}/remove`],
    ['PATCH', `/admin/properties/${target}/boundary`],
    ['POST', `/admin/properties/${target}/images/presigned-url`],
    ['POST', `/admin/properties/${target}/images/confirm`],
    ['POST', `/admin/properties/${target}/images/remove`],
    ['POST', `/admin/users/${target}/ban`],
    ['DELETE', `/admin/users/${target}`],
    ['GET', '/admin/moderation/reports'],
    ['GET', `/admin/moderation/reports/property/${target}`],
    ['GET', '/admin/ads'],
    ['POST', '/admin/ads/uploads'],
    ['POST', '/admin/ads'],
    ['DELETE', `/admin/ads/${target}`],
  ]) {
    it.each(['anonymous', 'user', 'unverified-admin'])(
      `protects ${method} ${path} from %s`,
      async (caller) => {
        const headers: Record<string, string> = {
          'x-user-id': target,
          'x-user-role': 'admin',
          'x-admin-mfa': 'true',
        };
        if (caller !== 'anonymous')
          headers.authorization = `Bearer ${keys.sign({ ...claims, ...(caller === 'user' ? { role: 'user' } : { adminMfa: false }) })}`;
        const response = await fetch(`${base}${path}`, { method, headers });
        expect([401, 403]).toContain(response.status);
        expect(platform.property).not.toHaveBeenCalled();
        expect(platform.mutate).not.toHaveBeenCalled();
        expect(platform.account).not.toHaveBeenCalled();
        expect(reportGroups.groups).not.toHaveBeenCalled();
      },
    );
  }
  it('rejects empty moderation reasons and invalid advertisement paths for a verified admin', async () => {
    const headers = {
      authorization: `Bearer ${keys.sign(claims)}`,
      'content-type': 'application/json',
    };
    for (const path of [
      `/admin/users/${target}/ban`,
      `/admin/properties/${target}/remove`,
    ]) {
      expect(
        (
          await fetch(`${base}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ reason: '  ' }),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await fetch(`${base}/admin/ads`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ path: '../anything' }),
        })
      ).status,
    ).toBe(400);
    expect(platform.mutate).not.toHaveBeenCalled();
    expect(platform.account).not.toHaveBeenCalled();
  });
});
