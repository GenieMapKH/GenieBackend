/**
 * API versions, reached as `@tilomnov/shared/api-versions`: light enough for
 * the gateway, which must not load the database client.
 */
export {
  API_VERSION_RETIRED,
  API_VERSIONS,
  apiVersionStatus,
} from './api-versions';
export type { ApiVersions, ApiVersionStatus } from './api-versions';
export { enableApiVersioning } from './enable-api-versioning';
