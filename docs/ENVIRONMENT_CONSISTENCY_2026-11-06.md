# Staging and production consistency — 6 November 2026

Both Railway stacks are deployed and healthy. The running deployment snapshots match
the saved configuration and the production Infisical service folders. Full sanitized
deployment IDs, image digests, routes and APK hashes are in
[the evidence report](ENVIRONMENT_CONSISTENCY_2026-11-06.json).

## Failure reproduced and fixed

The first staging run passed 65 flows and failed 8. Authentication and Chat logs showed
`EMAXCONNSESSION`: Supabase's session pooler allows 15 clients. The configured/default
maximum across six services was 36. This produced 500 responses for login, sessions,
refresh and chat despite successful liveness checks.

Each database service now uses `DATABASE_POOL_MAX=2`, `DATABASE_POOL_MIN=0` and
`DATABASE_POOL_IDLE_SECONDS=10`: 12 sessions total, with room for one rolling replacement.
The shared code's default is also 2. Rebudget before adding replicas or local writers.
The local backend uses staging's database, so its pool limits and message encryption key
were aligned too. Already running local processes need restarting to read the updated `.env`.

Other differences corrected:

- Staging Authentication's saved port was `4001 ` while its clients used 8080. Both
  environments now explicitly use 8080, with whitespace removed from service URLs.
- Production Users ran an older revision. All seven services in both environments now
  run the staging-verified source, including managed chat, unavailable saved cards and
  cache fixes. No database schema or history migration was performed.
- The new Dockerfile's cache mounts were rejected before building. Removed those mounts
  while retaining normal Docker layer caching. Railway requires literal service-specific
  cache mount IDs ([Railway Dockerfile documentation](https://docs.railway.com/builds/dockerfiles)).
  CI now builds all seven images with their explicit `SERVICE` arguments.
- Every service has a `/health` deployment gate with a 300-second timeout. Authentication
  now registers that controller. Liveness alone still does not prove database health.
- Distinct stable `CHAT_MESSAGE_SECRET` values are configured and backed up in Infisical.
  Production's stale Chat `DIRECT_URL` now points at production too.
- Production storage now uses the production Supabase project. At cutover there were no
  production file references or owned objects to copy from staging. Three production buckets
  were prepared and private upload, signed download and removal were verified. Staging's
  132 objects were untouched. See [storage evidence](PRODUCTION_STORAGE_CUTOVER_2026-11-06.json).
- Production Infisical folders now contain the corrected values, so a later sync keeps
  the same ports, pools, storage credentials and chat key. Sync redeploys retained the
  uploaded release images; the final snapshots contain no pending variable differences.

## APKs and repeatable checks

Both ARM64 release APKs were built from the same Flutter source. Their signatures verify,
their signing certificate is registered for both Firebase Android clients, and the named
copies in `Desktop/app` match the verified build artifacts.

| APK | Package | Compiled gateway |
|---|---|---|
| `tilomnov-staging.apk` | `com.sparkbytekh.tilomnov.staging` | `https://gateway-staging-c9ff.up.railway.app` |
| `tilomnov-production.apk` | `com.sparkbytekh.tilomnov` | `https://tilomnovgateway.sparkbytekh.com` |

Use these named release APKs. The older staging debug APK uses a different signing key;
staging's Firebase configuration registers the release certificate. Android release builds
now reject missing environment settings and a staging label paired with the production
gateway. CI explicitly builds production with its production gateway.

```powershell
# From genie:
.\scripts\build_apk.ps1 -Env staging
.\scripts\build_apk.ps1 -Env production
```

```powershell
# From genie-backend/qa/parity; passwords stay in the ignored .env:
node check-live.js staging production
node run.js staging
```

The live check signs existing QA accounts in and out, reads protected service routes,
checks `no-store`, verifies TURN configuration, rejects tokens from the other environment,
and checks a refused checkout for a nonexistent listing. It creates no listings, messages,
preferences or payment transactions. The production QA Seller account was created with
explicit approval and remains for later checks.

## Validation and limits

- Staging: **73/73 flows passed**, including send/edit/delete, attachments, call signalling,
  session rotation/revocation and a warmed nearby result after unpublish. Saved Draft/Sold
  summaries stay visible; draft contacts and locations remain private.
- Both environments passed the authenticated live checks and configuration comparison.
  Database projects, storage projects, Redis credentials, internal signing secrets and
  managed message keys are separated. Railway Redis references were resolved within each
  environment when comparing snapshots; identical reference expressions do not mean a shared instance.
- Backend: all builds and lints passed; 1,005 workspace tests and 16 script tests passed.
  Six external Meilisearch integration tests remain skipped. The changed shared pool code's
  82 tests were rerun successfully. Both invalid release configurations were refused by Gradle.
- The prior Flutter analysis and 1,060 tests passed. Both signed release APKs built and their
  package names, compiled gateways and exported copies were verified.

Phone UI, Google sign-in interaction, Maps rendering and real call audio/background controls
still need device checks; iOS needs a Mac/iPhone. Staging public share links still use the
common production website because no staging website URL is configured. The paid payment
provider and production business-data mutation flows were not exercised.

The source changes remain local and uncommitted. Commit the reviewed changes before a future
GitHub source deployment; variable syncs preserve the currently uploaded images. Earlier
backup/rotation audit findings were outside this runtime fix and are not certified by these checks.
