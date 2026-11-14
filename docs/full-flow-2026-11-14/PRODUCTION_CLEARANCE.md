# Production clearance - 2026-11-14

## Verdict
Automated gates pass. Full production clearance is **not granted**: real provider,
Play Console and exact-artifact hardware gates below remain unresolved.

## Fresh verification
- Backend: all builds and lint pass; 1,585 workspace + 44 script tests pass.
- Flutter: formatting and analysis pass; 1,520 tests pass, zero skipped.
- Whole-app HTTP: 74/74 pass with fresh local PostgreSQL, restricted service roles,
  real seven-service HTTP, Redis and sockets; provider boundaries are fixtures.
- RabbitMQ: 17 recovery/delivery tests; persisted publishing/feed/takeover: 36 tests;
  security: 12 tests; pinned real Meilisearch: 6 tests. All pass.
- Prisma schema valid; production npm audit reports zero vulnerabilities.
- Live gateway health/public ads/closest/search return 200; protected endpoints reject
  guests; internal admin route returns 404. Feed is authenticated and correctly returns
  401, correcting an initial smoke-harness expectation (no product change).
- Live property role can project contact verification columns; password reads still
  fail 42501. Probe used READ ONLY then ROLLBACK and retained no customer rows.
- Initial Railway snapshot: all seven application services plus Redis/RabbitMQ SUCCESS.

## Release artifact
Signed, obfuscated production AAB built successfully at
`genie/build/app/outputs/bundle/release/app-release.aab` (99.1 MB), package
`com.sparkbytekh.tilomnov`, version `1.0.0+1`, target SDK 36.
SHA-256: `877f1daba4666a6733891d26293aeee4e929bd01c4c91efe207fea1a0beea772`.
Exact-build symbols: `genie/build/symbols/clearance-20261114-205634/`.
JAR signature verifies; self-signed certificate warnings do not prove the upload key
matches Play. Audit includes the merged release manifest, not only its source.
Version code remains 1 pending confirmation of the highest used Play code.

## Operational changes
- Preserve existing regression tests and whole-app local-flow runner; include flow
  dependencies and runner in CI.
- Skip optional staging deploy only when its project/environment variables are absent;
  never substitute production credentials. Build/test/Docker gates remain required.
- Removed an unused plaintext GitHub Actions DATABASE_URL variable; the separate
  encrypted DATABASE_URL secret remains. No workflow referenced the plaintext variable.
  This is not credential rotation; assess prior exposure and rotate through the existing
  coordinated secret-rotation workflow if that credential is still valid.

## Remaining release gates
- Production PAYMENT_MODE=enabled selects MOCK. ABA PayWay is still NotImplemented.
  Closed testing can exercise mock access, but **real-money clearance is blocked**.
  No bank transactions/refunds or production customer writes were performed.
- Exact Play-delivered AAB install/upgrade, SMS/Google sign-in, email/push delivery,
  camera/location/notifications, call microphone/TURN media and accessibility/device
  appearance require hardware validation. Automated call signaling is not audio proof.
- Verify Play version code/upload key, Data Safety/privacy declarations and full-screen
  intent eligibility in Play Console. This run did not upload or publish to Play.
- Local object storage/Places/Firebase fixtures do not prove production provider ACLs.
- Staging credentials are absent; no staging deployment is claimed.
- CI results, merges and post-merge deployment observation are recorded in follow-up.

## Evidence and cleanup
Fresh raw logs use `clearance-*.log` in this directory (locally retained and gitignored).
Machine-readable counts/config-free checks are in `clearance-*.json`; HTTP shapes and
fixture cleanup are in `http-flows.json` and `http-cleanup.json`. Flutter raw test events
are under `genie/build/clearance-2026-11-14/`. No secrets belong in these reports.
Disposable HTTP DB/Redis/storage/processes and Meilisearch container were removed.
Reusable messaging database is retained; test broker/PostgreSQL are restored stopped
after testing. Existing application containers are untouched. No new schema migration.
