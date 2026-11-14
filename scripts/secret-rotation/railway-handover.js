// Wait for Infisical sync AND deployed containers, without logging any variable values.
const { SERVICES, SHARED_PATH, servicePath } = require('./layout');

class HandoverNotReady extends Error {}

class RailwayHandover {
  constructor({ token, projectId, environmentId, serviceIds, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    if (!token || !projectId || !environmentId || SERVICES.some((s) => !serviceIds?.[s])) {
      throw new Error('Railway handover requires a project token, project/environment IDs and all six service IDs');
    }
    Object.assign(this, { token, projectId, environmentId, serviceIds, fetch: fetchImpl, wait });
  }

  async request(query, variables) {
    const response = await this.fetch('https://backboard.railway.com/graphql/v2', {
      method: 'POST', headers: { 'content-type': 'application/json', 'project-access-token': this.token },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Railway handover HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length || !body.data) throw new Error('Railway handover query failed');
    return body.data;
  }

  async activeVariables(service) {
    const { serviceInstance: instance } = await this.request(`query($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        latestDeployment { id status projectId }
        activeDeployments { id status projectId }
      }
    }`, { serviceId: this.serviceIds[service], environmentId: this.environmentId });
    const active = instance?.activeDeployments;
    if (!instance?.latestDeployment || !active?.length ||
      instance.latestDeployment.status !== 'SUCCESS' ||
      !active.some((d) => d.id === instance.latestDeployment.id)) {
      throw new HandoverNotReady(`${service}: latest deployment is ${instance?.latestDeployment?.status || 'missing'}; repair service startup/healthchecks before rotating credentials`);
    }
    const variables = [];
    for (const deployment of active) {
      if (deployment.projectId !== this.projectId || deployment.status !== 'SUCCESS') {
        throw new HandoverNotReady(`${service}: active deployment is not ready in the configured project`);
      }
      const { deploymentSnapshot: snapshot } = await this.request(`query($id: String!) {
        deploymentSnapshot(deploymentId: $id) { variables variablesRedacted }
      }`, { id: deployment.id });
      if (!snapshot?.variables || snapshot.variablesRedacted) {
        throw new HandoverNotReady(`${service}: deployment credentials are unavailable or redacted`);
      }
      variables.push(snapshot.variables);
    }
    return variables;
  }

  async matches(service, expected) {
    // Readiness errors remain failures, but waitFor may retry during deployment overlap.
    let variables;
    try { variables = await this.activeVariables(service); }
    catch (error) {
      if (error instanceof HandoverNotReady) return false;
      throw error;
    }
    return variables.every((snapshot) => Object.entries(expected).every(([key, value]) => snapshot[key] === value));
  }

  async reconcile(secrets) {
    const baseline = [];
    let shared;
    // Validate every active replica before writing: never adopt an arbitrary store value over live credentials.
    for (const service of SERVICES) {
      const snapshots = await this.activeVariables(service);
      const keys = ['DATABASE_URL', 'INTERNAL_SERVICE_SECRET', ...(service === 'authentication' ? ['JWT_KEY_ENCRYPTION_KEY'] : [])];
      const expected = Object.fromEntries(keys.map((key) => [key, snapshots[0][key]]));
      if (keys.some((key) => typeof expected[key] !== 'string' || !expected[key] || expected[key].includes('${') || snapshots.some((snapshot) => snapshot[key] !== expected[key]))) {
        throw new Error(`${service}: active replicas have missing or inconsistent credentials; bootstrap made no changes`);
      }
      if (!/^postgres(ql)?:$/.test(new URL(expected.DATABASE_URL).protocol)) throw new Error(`${service}: active DATABASE_URL is invalid; bootstrap made no changes`);
      if (expected.INTERNAL_SERVICE_SECRET.length < 32 || (shared && shared !== expected.INTERNAL_SERVICE_SECRET)) {
        throw new Error('Active services do not share one valid internal secret; bootstrap made no changes');
      }
      shared = expected.INTERNAL_SERVICE_SECRET;
      baseline.push({ service, expected });
    }
    for (const { service, expected } of baseline) {
      if (!(await this.matches(service, expected))) throw new Error(`${service}: deployment changed during bootstrap; retry after deployment finishes`);
    }
    for (const { service, expected } of baseline) {
      for (const [key, value] of Object.entries(expected)) {
        if (await secrets.get(servicePath(service), key) !== value) await secrets.set(servicePath(service), key, value);
      }
    }
    if (await secrets.get(SHARED_PATH, 'INTERNAL_SERVICE_SECRET') !== shared) await secrets.set(SHARED_PATH, 'INTERNAL_SERVICE_SECRET', shared);
    for (const { service, expected } of baseline) await this.waitFor([service], expected);
  }

  async waitFor(services, expected, attempts = 40) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      let ready = true;
      for (const service of services) {
        if (!(await this.matches(service, expected))) ready = false;
      }
      if (ready) return;
      if (attempt + 1 < attempts) await this.wait(15000);
    }
    throw new Error('Railway has not delivered the credential handover; rotation stopped. Check syncs and deployments before retrying.');
  }

  async preflight(secrets) {
    const current = await secrets.get(SHARED_PATH, 'INTERNAL_SERVICE_SECRET');
    if (!current || current.length < 32) throw new Error('A valid internal service secret is required before rotation');
    for (const service of SERVICES) {
      await this.activeVariables(service);
      const databaseUrl = await secrets.get(servicePath(service), 'DATABASE_URL');
      if (!databaseUrl) throw new Error(`${service}: DATABASE_URL missing`);
      const expected = { INTERNAL_SERVICE_SECRET: current, DATABASE_URL: databaseUrl };
      if (service === 'authentication') {
        expected.JWT_KEY_ENCRYPTION_KEY = await secrets.get(servicePath(service), 'JWT_KEY_ENCRYPTION_KEY');
        if (!expected.JWT_KEY_ENCRYPTION_KEY) throw new Error('JWT encryption key missing');
      }
      if (!(await this.matches(service, expected))) {
        throw new Error(`${service}: running credentials do not match Infisical, or a deployment is in progress. Nothing was rotated.`);
      }
    }
  }
}

function railwayHandoverFromEnv() {
  let serviceIds;
  try { serviceIds = JSON.parse(process.env.ROTATION_RAILWAY_SERVICE_IDS || '{}'); }
  catch { throw new Error('ROTATION_RAILWAY_SERVICE_IDS must be a JSON object'); }
  return new RailwayHandover({ token: process.env.ROTATION_RAILWAY_TOKEN,
    projectId: process.env.ROTATION_RAILWAY_PROJECT_ID,
    environmentId: process.env.ROTATION_RAILWAY_ENVIRONMENT_ID, serviceIds });
}

module.exports = { RailwayHandover, railwayHandoverFromEnv };
