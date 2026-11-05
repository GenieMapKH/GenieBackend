// The few Infisical API calls the rotation needs, as a machine identity
// (Universal Auth). Secret values are never logged.

const TIMEOUT_MS = 15_000;

class InfisicalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Secrets of one project environment. `get` answers null for a missing
 * secret; `set` updates it, or creates it when it does not exist yet.
 */
class InfisicalSecrets {
  constructor({ apiUrl, projectId, environment, fetchImpl = fetch }) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.projectId = projectId;
    this.environment = environment;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async login(clientId, clientSecret) {
    const body = await this.request('POST', '/api/v1/auth/universal-auth/login', { clientId, clientSecret }, false);
    this.token = body.accessToken;
  }

  async get(secretPath, name) {
    const query = new URLSearchParams({
      projectId: this.projectId,
      environment: this.environment,
      secretPath,
      // A reference must come back as written, or a rewrite would freeze it.
      expandSecretReferences: 'false',
      includeImports: 'false',
    });
    try {
      const body = await this.request('GET', `/api/v4/secrets/${encodeURIComponent(name)}?${query}`);
      return body.secret.secretValue;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async set(secretPath, name, secretValue) {
    const body = { projectId: this.projectId, environment: this.environment, secretPath, secretValue };
    const path = `/api/v4/secrets/${encodeURIComponent(name)}`;
    try {
      await this.request('PATCH', path, body);
    } catch (error) {
      if (error.status !== 404) throw error;
      await this.request('POST', path, body);
    }
  }

  /** Creates `/<name>` below `path`. Already there is fine. */
  async ensureFolder(path, name) {
    try {
      await this.request('POST', '/api/v2/folders', {
        projectId: this.projectId,
        environment: this.environment,
        name,
        path,
      });
    } catch (error) {
      if (!(error.status >= 400 && error.status < 500 && /exist/i.test(error.message))) throw error;
    }
  }

  async request(method, path, body, authenticated = true) {
    const headers = { 'content-type': 'application/json' };
    if (authenticated) {
      if (!this.token) throw new Error('Not logged in to Infisical');
      headers.authorization = `Bearer ${this.token}`;
    }
    const response = await this.fetch(`${this.apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      // Infisical's error body names the problem, never a secret value.
      let message = text;
      try {
        message = JSON.parse(text).message ?? text;
      } catch {
        // Not JSON: keep the text.
      }
      throw new InfisicalError(response.status, `Infisical ${method} ${path.split('?')[0]}: ${response.status} ${message}`);
    }
    return text ? JSON.parse(text) : {};
  }
}

module.exports = { InfisicalSecrets, InfisicalError };
