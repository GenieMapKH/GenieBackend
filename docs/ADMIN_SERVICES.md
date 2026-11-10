# Admin Services

The Flutter admin Services tab now has independent HTTP health, Infisical rotation history,
force rotation, Sentry logs/errors and Railway recovery panels. Integration failures do not
prevent the HTTP health panel from loading. Secrets remain on the backend.

## Connect the user service

All routes require the existing signed admin access token, completed admin MFA, an active
admin account and a non-revoked session. Write actions require a reason (3–500 trimmed
characters) and create an audit record before calling a provider. A completed audit action
ending in `.request` means the provider accepted the request, not that the job finished.

Set the following environment variables on **user**:

| Integration | Variables | Required permissions |
| --- | --- | --- |
| Infisical history | `ADMIN_INFISICAL_CLIENT_ID`, `ADMIN_INFISICAL_CLIENT_SECRET`, `ADMIN_INFISICAL_PROJECT_ID`, `ADMIN_INFISICAL_ENVIRONMENT` | Dedicated Universal Auth machine identity: read **only** `AUTHENTICATION_ROTATED_AT`, `USER_ROTATED_AT`, `PROPERTY_ROTATED_AT`, `CHAT_ROTATED_AT`, `PAYMENT_ROTATED_AT`, `NOTIFICATION_ROTATED_AT`, `SHARED_ROTATED_AT` in `/rotation`. Do not give this identity access to saved database passwords. |
| Sentry | `ADMIN_SENTRY_TOKEN`, `ADMIN_SENTRY_ORGANIZATION`, `ADMIN_SENTRY_PROJECT_IDS` (comma separated), `ADMIN_SENTRY_ENVIRONMENT` | Read token with `org:read` for the configured organization/projects. This is a read API token, not a DSN or upload token. |
| Force rotation | `ADMIN_ROTATION_GITHUB_TOKEN`, `ADMIN_ROTATION_GITHUB_REPOSITORY` (`owner/repository`), `ADMIN_ROTATION_GITHUB_REF` (production branch) | Fine-grained GitHub token restricted to this repository with Actions read/write. Never use the Flutter app's token to call GitHub. |
| Recovery | `ADMIN_RAILWAY_PROJECT_TOKEN`, `ADMIN_RAILWAY_PROJECT_ID`, `ADMIN_RAILWAY_ENVIRONMENT_ID`, `ADMIN_RAILWAY_SERVICE_IDS` (JSON object) | Railway project token restricted to the production environment. |

Optional bases: `INFISICAL_API_URL` (default `https://app.infisical.com`) and
`ADMIN_SENTRY_URL` (default `https://sentry.io`; use the organization's regional or self-hosted host if required).
No environment defaults to production: set each integration's environment explicitly.

`ADMIN_RAILWAY_SERVICE_IDS` maps any of `api-gateway`, `authentication`, `user`, `property`,
`chat`, `payment`, `notification` to their Railway UUIDs. No client-supplied project,
environment, repository or service ID is accepted.

## Force rotate all

The button dispatches `.github/workflows/secret-rotation.yml` with `force=true`,
`dry_run=false`, `only=''`. The dashboard displays recent workflow status; use **Refresh
workflow status** to follow the run. GitHub workflow concurrency serializes scheduled and
manual jobs. Redis prevents duplicate clicks and overlapping dashboard operation requests.

Managed credentials are the six service database logins, `INTERNAL_SERVICE_SECRET` and
`JWT_KEY_ENCRYPTION_KEY`. Changing the latter creates a fresh JWT signing key on Authentication
startup while retaining the old public keys. Existing access/refresh tokens are not revoked,
and this operation does not change user passwords. Provider-owned credentials such as Redis,
Supabase service keys, Firebase, mail, payments, Sentry and GitHub tokens require their own
provider rotation process and are outside this button's scope.

The workflow now requires these **GitHub Actions** settings for every non-dry run:

- Secret `ROTATION_RAILWAY_TOKEN`: a project token scoped to the same environment as Infisical.
- Variables `ROTATION_RAILWAY_PROJECT_ID` and `ROTATION_RAILWAY_ENVIRONMENT_ID`.
- Variable `ROTATION_RAILWAY_SERVICE_IDS`: JSON mapping **all six** database service names
  (excluding `api-gateway`) to their Railway UUIDs.
- The existing Infisical settings and rotation identity from [SECRET_ROTATION.md](SECRET_ROTATION.md).

**Deploy the workflow and configure these settings before enabling the button.** Until they
are set, scheduled and forced non-dry runs fail closed before changing a credential.
The job timeout is two hours to accommodate sequential handovers; each wait for a deployment
is bounded to about ten minutes plus API request time.

The job checks all active Railway deployment snapshots against the Infisical credentials
before writing anything. A missing, failed, in-progress or redacted deployment blocks it.
Database rotation changes only the unused alternating login, proves its new password, leaves
the old login valid, and waits for the service to deploy its new `DATABASE_URL`.

Shared rotation first deploys the new value as `INTERNAL_SERVICE_SECRET_PREVIOUS` to **every**
active container. After all accept it, it switches `INTERNAL_SERVICE_SECRET` to the new value,
waits for all containers, then retains the old value as `_PREVIOUS`. It waits for the new JWT
encryption key to reach Authentication before recording shared rotation success. On a failed
handover it stops further tasks; already completed tasks remain completed. A rotation run is
not a transaction across all services. Check job status and service health before retrying.

Infisical must sync the root shared variables and the per-service folders to the correct
Railway environment, with redeployment enabled. Literal service variables must not override
shared-variable references. Bootstrap the alternating database logins first. Timestamp records
show when the job changed credentials, not an independent proof that containers received them.

The handover preserves credential compatibility and user sessions. Real availability still
depends on Railway health checks, deployment overlap and the app's reconnect behavior.
Active chat/call connections may reconnect when containers restart. Validate an end-to-end
rotation in staging (including sign-in, refresh, publishing, payment, chat and calls) before
enabling production force rotation; this implementation has not exercised production.

## Sentry feed

The read API queries the configured environment and projects for the last 24 hours in pages
of 100. Switch between structured **Logs** and **Errors**. Live mode refreshes the newest page
every ten seconds while the app is foregrounded and the route is visible. Scrolling or loading
older events pauses live updates; **Resume live** returns to the newest page. A failed refresh
keeps the last successful data and marks it stale. Requests use bounded timeouts and never
follow a pagination URL supplied by the browser; only its opaque cursor is forwarded.

To forward backend application logs, set `SENTRY_ENABLE_LOGS=true` and a valid `SENTRY_DSN` on
each backend service. The shared Nest logger preserves stdout and forwards enabled application
log levels to Sentry, redacting configured secret values, URL credentials and bearer tokens.
Raw object payloads are omitted. Arbitrary stdout/stderr from dependencies, database logs,
build logs and mobile logs are not automatically forwarded by this logger. Sentry ingestion,
quotas and retention still apply; the feed is polling, not a zero-delay stream.

## Production recovery

For each configured service, the UI shows its latest deployment and the newest retained
older deployment Railway marks as eligible for rollback (searched among the latest 20).
This is a previous **successful deployment**, not a certification of business correctness.
The operator reviews the service, target commit/date, and impact before entering a reason.

The backend rereads the deployment list, rejects stale latest/target IDs and unknown services,
rejects in-progress deploys and active rotation jobs, and checks snapshot credentials. Railway
rollback restores both the image and custom variables, so recovery is blocked if the target
differs in `DATABASE_URL`, `INTERNAL_SERVICE_SECRET`, `_PREVIOUS` or `JWT_KEY_ENCRYPTION_KEY`, or
if either snapshot is unavailable/redacted. Such targets need the old code redeployed with
current credentials through Railway. Other provider keys must also still be valid.

Rollback is per service, not an atomic release-wide restore. It does not reverse database
migrations, stored data, third-party actions or installed mobile app releases. After acceptance,
refresh deployment status and HTTP health, then check the affected feature. Provider timeouts
have an unknown outcome: check status before retrying. Retention limits can remove old targets.
If the user service, gateway or authentication is unavailable, use Railway directly: a recovery
control hosted inside a broken application cannot be the only recovery path.

## API contracts

| Method / path (under `/v1`) | Input | Result |
| --- | --- | --- |
| `GET /admin/dashboard/rotations` | None | `{status, checkedAt, environment, credentials:[{name,status,lastRotatedAt}]}`. Integration status: `ok`, `not_configured`, `unavailable`; credential status: `recorded`, `never_recorded`, `unavailable`. |
| `GET /admin/operations/rotation-job` | None | `{status,busy,runs:[{id,status,conclusion,createdAt,url}]}`. Missing config returns `not_configured`; provider failure returns 503. |
| `POST /admin/operations/rotation-job` | `{reason}` | 201 `{status:'accepted',runId}`. 409 for an active job/operation; 503 for provider failure/unknown dispatch outcome. |
| `GET /admin/operations/logs` | `dataset=logs|errors` (default logs), optional `cursor` (max 1000 characters) | `{status,checkedAt,environment,entries:[{id,timestamp,project,level,message}],nextCursor}`. Missing config returns `not_configured`; provider failure returns 503. |
| `GET /admin/operations/deployments` | None | `{status,checkedAt,services:[{name,latest,previous}]}`. Each deployment is `{id,status,createdAt,commit}` or null. |
| `POST /admin/operations/deployments/:service/rollback` | `{reason,deploymentId,expectedLatestId}`; IDs must be UUIDs | 201 `{status:'accepted'}`. 409 for stale/ineligible targets, credential mismatch or active operations; 503 for provider failure/unknown outcome. |

All routes reject unauthorized callers with 401/403; invalid query/body fields return 400.

Provider references: [Railway rollback](https://docs.railway.com/deployments/deployment-actions),
[Railway project-token authentication](https://docs.railway.com/integrations/api),
[Sentry event tables](https://docs.sentry.io/api/explore/query-explore-events-in-table-format/),
[GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
The Railway GraphQL schema was inspected directly: `deploymentRollback(id)` returns a Boolean;
`deploymentSnapshot(deploymentId)` exposes `variables` and `variablesRedacted`.
