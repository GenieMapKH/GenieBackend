import { Injectable } from '@nestjs/common';

const SERVICES = [
  ['API gateway', 'GATEWAY_SERVICE_URL', 4000],
  ['Authentication', 'AUTH_SERVICE_URL', 4001],
  ['Users', 'USER_SERVICE_URL', 4002],
  ['Listings', 'PROPERTY_SERVICE_URL', 4003],
  ['Chat', 'CHAT_SERVICE_URL', 4004],
  ['Payments', 'PAYMENT_SERVICE_URL', 4005],
  ['Notifications', 'NOTIFICATION_SERVICE_URL', 4006],
] as const;

@Injectable()
export class AdminSystemHealthService {
  async check() {
    const services = await Promise.all(
      SERVICES.map(async ([name, env, port]) => {
        const base =
          process.env[env] ||
          (env === 'USER_SERVICE_URL'
            ? `http://localhost:${process.env.PORT || port}`
            : process.env.NODE_ENV === 'production'
              ? null
              : `http://localhost:${port}`);
        if (!base) return { name, status: 'not_configured', latencyMs: null };
        const start = Date.now();
        try {
          const response = await fetch(`${base.replace(/\/+$/, '')}/health`, {
            signal: AbortSignal.timeout(3000),
            redirect: 'error',
          });
          const body = response.ok
            ? ((await response.json()) as { status?: string })
            : null;
          return {
            name,
            status: response.ok && body?.status === 'ok' ? 'up' : 'down',
            latencyMs: Date.now() - start,
            httpStatus: response.status,
          };
        } catch {
          return { name, status: 'down', latencyMs: Date.now() - start };
        }
      }),
    );
    return { checkedAt: new Date().toISOString(), services };
  }
}
