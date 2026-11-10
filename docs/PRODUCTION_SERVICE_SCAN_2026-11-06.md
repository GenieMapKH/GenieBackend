# Production service scan

Checked 6 November 2026, approximately 17:56-17:59 Cambodia time (UTC+7), after the Authentication connection repair.

Latest connection recheck and completed repair: [Production database URL problem and exact fix](PRODUCTION_DB_URL_FIX.md). The four remaining runtime database URLs were repaired through the CLI and verified at approximately 18:15; production listing discovery now returns HTTP 200. The snapshot below records the earlier failures; Storage isolation and unused credential cleanup remain outstanding.

Read-only inspection of all eight Railway services: deployment metadata, configured variables, current-deployment logs, Infisical database secrets, public HTTP GET requests, and a Supabase bucket-list request. No production configuration, deployments, credentials, accounts, storage objects, or database records were changed during this scan. No secret values are recorded here.

## Findings, in priority order

### 1. High: five services retain the unreachable IPv6 database endpoint

Users, Property, Chat, Payment, and Notification still use `db.ovrwutngmsompqpchlgt.supabase.co:5432` as `postgres`. This is the same IPv6-only endpoint that prevented Authentication from starting. Each service's Railway `DATABASE_URL` matches its Infisical `prod` folder, so a direct Railway edit alone would leave the source of the error intact.

- Users and Property have recent `ENETUNREACH` and Prisma failures in their active-deployment logs.
- Notification's startup logs also contain `ENETUNREACH`.
- Production `GET /v1/public/properties/closest?lat=11.55&lng=104.92` returns **500**; the equivalent staging request returns **200**.
- Chat and Payment start and listen, but no recent database requests appeared in their logs. Their database connectivity is a configuration risk, not a separately demonstrated endpoint failure in this scan.

Correct `DATABASE_URL` in Infisical `prod` folders `/user`, `/property`, `/chat`, `/payment`, and `/notification` to the production session pooler, then verify sync, redeployment, and actual database operations. Authentication now uses `aws-0-ap-southeast-1.pooler.supabase.com:5432` with the production tenant-qualified username. The five remaining passwords match the working production Authentication database password; no password reset is needed to repair the endpoint.

### 2. High: production Storage still targets staging

Users, Property, and Chat have `SUPABASE_URL` pointing to `nzurymawikvamjjfbdmz.supabase.co` and a service-role key identifying that staging project. Authentication also carries these staging variables, although its current account implementation uses Prisma rather than Supabase.

A read-only request with production Property's configured credential successfully listed staging's three buckets (HTTP **200**). The production Property Storage key exactly matches staging Property's key. Production avatars, listing photos, and chat attachments therefore use staging Storage credentials rather than isolated production Storage.

Separate production Storage before relying on production testing. Check and migrate any existing objects and stored URLs before changing the destination; replacing the URL and key alone does not move files. No upload, deletion, or migration was performed.

### 3. Medium: Chat and Payment retain staging database URLs

Their `DIRECT_URL` usernames identify the staging tenant `nzurymawikvamjjfbdmz`. Their normal application queries use `DATABASE_URL`, so these stale variables do not demonstrate that runtime SQL is reaching staging. Correct or remove them before using migration or administrative tooling that might consume them.

### 4. Medium: runtime database credentials still have administrator scope

All six database services use the `postgres` administrator login, including Authentication's tenant-qualified pooler username. The configured per-service `*_DATABASE_URL` values are separate variables; the shared runtime Prisma client reads `DATABASE_URL`.

Repair availability first, then validate and deploy each service's restricted database login through `DATABASE_URL`. Do not switch blindly to the alternate variables: their authentication and grants were not tested in this scan. This scan did not bootstrap or rotate database roles.

## Service summary

| Service | Deployment | Evidence and limitation |
|---|---|---|
| Authentication | SUCCESS | Production JWKS HTTP 200; pooler configuration remains in place; no recent error patterns found. |
| Gateway | SUCCESS | `/health` HTTP 200; forwards the working JWKS route. Earlier auth upstream errors predate the repair. A healthy gateway does not establish upstream database health. |
| Users | SUCCESS | Recent IPv6 database failures; Storage targets staging. |
| Property | SUCCESS | Recent IPv6 database failures; public closest-listings request HTTP 500; Storage targets staging. |
| Chat | SUCCESS | Startup listening; bad database endpoint and staging Storage settings; authenticated data paths not exercised. |
| Payment | SUCCESS | Startup listening; bad database endpoint; checkout and webhook not exercised. |
| Notification | SUCCESS | Startup listening; startup IPv6 database error; push delivery not exercised. |
| Redis | SUCCESS | No inspected recent error patterns; all six configured Redis clients match the production Redis URL. No direct PING was possible. |

The six backend services' `INTERNAL_SERVICE_SECRET` values agree. All six Infisical database secrets match Railway. These checks establish configuration agreement, not successful delivery of every internal request.

## HTTP checks

| Request | Production | Staging |
|---|---|---|
| `GET /health` | 200 | 200 |
| `GET /v1/auth/.well-known/jwks.json` | 200 | 200 |
| `GET /v1/public/properties/closest?lat=11.55&lng=104.92` | 500 | 200 |
| Unauthenticated GET requests under `/v1/users`, `/v1/chat`, `/v1/payments`, `/v1/notifications` | 401 | 401 |

The 401 responses confirm that the gateway rejects unauthenticated calls. They do not test the protected upstream services. The shared `/health` controller intentionally checks process liveness without querying the database, so Railway's SUCCESS status is not evidence that database requests work.

## Scan limits

- Recent-log scan: up to 250 entries per active deployment from the preceding two hours. For Chat, Payment, Notification, and Gateway, also inspected up to 250 entries without a time filter to include startup evidence. Counts may contain multiple lines from one exception.
- A private-network health and Redis PING probe through Gateway SSH could not run: Railway reported no registered SSH keys. No SSH key was registered and no access settings were changed.
- No real-user sign-in, authenticated chat, calls, payments, push/email delivery, Storage uploads, destructive checks, or write-producing parity suite ran.
- Current variables and deployment logs were inspected; the process environment inside each container was not independently captured. Dormant paths and uncaught provider failures may remain.

## Follow-up: Users connection repaired

At approximately 18:00 Cambodia time on 6 November 2026, corrected Infisical `prod` `/user/DATABASE_URL` to the production session pooler, preserving the production database and password. Railway synced the value and deployment `c431d776-5104-4609-80c3-21dbec61e667` reached SUCCESS. Its startup logs show the service listening without IPv6 or Prisma errors.

Verified the local compiled `UsersService.getProfile()` against an existing production account through the corrected connection, including profile mapping assertions, without printing customer data or writing account records. The complete signed-in request from the APK was not exercised. This backend connection repair does not require an APK rebuild. The other findings in this scan remain outstanding.
