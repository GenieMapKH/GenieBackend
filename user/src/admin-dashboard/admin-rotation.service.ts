import { Injectable } from '@nestjs/common';

const CREDENTIALS = [
  ['Authentication database', 'AUTHENTICATION'],
  ['Users database', 'USER'],
  ['Listings database', 'PROPERTY'],
  ['Chat database', 'CHAT'],
  ['Payments database', 'PAYMENT'],
  ['Notifications database', 'NOTIFICATION'],
  ['Internal service secret and JWT encryption key', 'SHARED'],
] as const;

@Injectable()
export class AdminRotationService {
  async status() {
    const clientId = process.env.ADMIN_INFISICAL_CLIENT_ID;
    const clientSecret = process.env.ADMIN_INFISICAL_CLIENT_SECRET;
    const projectId = process.env.ADMIN_INFISICAL_PROJECT_ID;
    const environment = process.env.ADMIN_INFISICAL_ENVIRONMENT;
    const checkedAt = new Date().toISOString();
    if (!clientId || !clientSecret || !projectId || !environment)
      return {
        status: 'not_configured',
        checkedAt,
        environment: null,
        credentials: [],
      };
    const base = (
      process.env.INFISICAL_API_URL || 'https://app.infisical.com'
    ).replace(/\/+$/, '');
    try {
      const login = await fetch(`${base}/api/v1/auth/universal-auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!login.ok) throw new Error('Infisical login failed');
      const { accessToken } = (await login.json()) as { accessToken: string };
      if (!accessToken) throw new Error('Infisical token missing');
      const credentials = await Promise.all(
        CREDENTIALS.map(async ([name, key]) => {
          const query = new URLSearchParams({
            projectId,
            environment,
            secretPath: '/rotation',
            expandSecretReferences: 'false',
            includeImports: 'false',
          });
          try {
            const response = await fetch(
              `${base}/api/v4/secrets/${key}_ROTATED_AT?${query}`,
              {
                headers: { authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(5000),
                redirect: 'error',
              },
            );
            if (response.status === 404)
              return { name, status: 'never_recorded', lastRotatedAt: null };
            if (!response.ok) throw new Error('Infisical read failed');
            const body = (await response.json()) as {
              secret: { secretValue: string };
            };
            const time = Date.parse(body.secret.secretValue);
            if (!Number.isFinite(time) || time > Date.now())
              throw new Error('Invalid rotation date');
            return {
              name,
              status: 'recorded',
              lastRotatedAt: new Date(time).toISOString(),
            };
          } catch {
            return { name, status: 'unavailable', lastRotatedAt: null };
          }
        }),
      );
      return { status: 'ok', checkedAt, environment, credentials };
    } catch {
      return { status: 'unavailable', checkedAt, environment, credentials: [] };
    }
  }
}
