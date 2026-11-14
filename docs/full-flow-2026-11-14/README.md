# Full-app test audit — 2026-11-14

## Scope

Backend workspace suites, Flutter unit/widget suites, full seven-service local HTTP
journeys, restricted-role PostgreSQL flows, RabbitMQ recovery, security boundaries
and the real Meilisearch engine. No production requests or writes were used in this run.

## Free and Silver publishing decisions

| Account state | Expected and verified behavior |
| --- | --- |
| Free, no active plan-backed listing | First public listing succeeds; Flutter makes zero checkout requests |
| Free, one active plan-backed listing | Another unpaid public post returns 402; UI requires a publishing choice; one-time checkout succeeds with the mock provider |
| Silver, 0/1/9 used | UI publishes directly, with no payment screen and zero payment requests |
| Silver, fewer than 10 used | Real HTTP public posts succeed without additional payment transactions |
| Silver, 10 used | Another unpaid public post returns 402; UI requires a publishing choice |
| Individually paid listing | Its protected publication does not consume subscription capacity |
| Archive then republish | Capacity is released/reused, with no extra checkout and no publish-date bump |
| Cancel subscription | Current benefits remain until expiry; persisted tests cover expiry and renewal |

## Complete HTTP journey

`FLOW-PLAN` runs through the real public gateway and service-to-service calls:

1. Register, log in and read the authenticated profile.
2. Publish the first Free listing; refuse a second unpaid public listing.
3. Save the second as a draft and complete a one-time mock checkout.
4. Request a Silver quote, buy Silver and verify its persisted ten-listing limit.
5. Fill the remaining included slots; verify exactly one listing payment and one
   subscription transaction exist, not a checkout for every included listing.
6. Reject capacity overflow; archive and republish an included listing.
7. Cancel renewal and verify benefits remain; log out and reject the old access token.
8. Sign in, establish the disposable device's age, change the password and reject
   the old password.
9. Deactivate, reject the old token, then sign in to reactivate.
10. Delete the account through the API; verify account/listing rows are removed,
    tokens stop working and successful financial records remain with the user unlinked.

The other 73 HTTP scenarios cover registration/input refusals, refresh/session theft
protection, profile edits/avatar uploads, property photo upload/download/thumbnail,
ownership/privacy, publishing/archive/sold/relist/delete, feed/map/search/saved
searches, favorites/likes/views/leads, follows/blocks, chat sockets/messages/attachments/
replies/edits/deletes/archives/read state, call signaling/history, notification device
registration/preferences and payment/admin authorization refusals.

## Results and evidence

- `backend-full-tests.log`: **1,585 workspace tests + 44 script tests passed**.
  The base invocation skips 42 optional database/search tests; all 42 are separately
  exercised by the persisted-flow and Meilisearch runs below.
- `flutter-final-tests.jsonl`: **1,520 actual tests passed, zero skipped**. Loader
  events are excluded from this count. `flutter-full-tests.jsonl` retains the initial
  failed run for the timing regression described below.
- `http-flows.json`: **74/74 local HTTP scenarios passed**, zero skipped/failed.
  Steps include their request method/path/status and sanitized response shapes.
- `http-cleanup.json`: service processes stopped, disposable DB removed, isolated
  Redis container removed, fixture object-storage server closed.
- `persisted-flows.log`: subscription/publication, feed and takeover database flows.
- `broker-integration.log`: actual broker delivery, deduplication, retry, reconnection,
  restart preservation, shutdown and dead-letter recovery checks.
- `security-integration.log`: account/session revocation, least-privilege database
  roles, upload budgets/reservations and RabbitMQ ACL integration checks.
- `meilisearch-tests.log`: **6 real-engine tests passed** against the repository's
  pinned `getmeili/meilisearch:v1.54.3` in a disposable local container.
- `backend-build.log`, `backend-lint.log`, `flutter-analyze.log`: all-service builds,
  all-workspace lint and Flutter analysis passed.

`summary.json` records final suite counts and cleanup observations.

## Changes made

- Added a repeatable `npm run test:app:flows` local stack and wired it into backend CI.
- Added Silver UI boundary cases and strengthened Free/Silver tests to assert no
  payment HTTP requests, not merely absence of a payment screen.
- Fixed a timing-sensitive Flutter test: it asserted network quality before an
  asynchronous health probe completed. It now awaits that probe; product timing
  thresholds and behavior are unchanged.
- Updated stale parity test contracts for the retired phone-reset endpoint and
  required email proof. HTTP avatar URLs are accepted only for the named loopback
  fixture; staging/production still require HTTPS.
- Provider setup failures in the first local HTTP attempts were fixture issues
  (encryption secret, loopback URL expectation, external Places configuration),
  not production application failures; final runs use explicit local fixtures.

No production application logic, production secrets, plans, payments or deployments
were changed by this test audit. Changes remain local/uncommitted.

## Reproduction

See `qa/app-flow/README.md` for the local HTTP stack. From backend:

```powershell
npm test
npm run build
npm run lint
docker compose -f qa/messaging/docker-compose.yml up -d --wait
npm run test:app:flows
npm run test:messaging:integration
npm run test:messaging:flows
npm run test:security:integration
```

From Flutter:

```powershell
flutter test
flutter analyze
```

## Remaining provider/device gates

This is broad automated coverage, not a proof of every possible interaction.
The HTTP suite uses real application modules, DB roles, Redis, sockets and internal
HTTP, but local object storage/Places/Firebase boundaries and mock payments.
RabbitMQ delivery is tested separately, not enabled inside the seven-service HTTP
fixture. Real SMS/Google sign-in, email/push delivery, Supabase production ACLs,
ABA bank app/settlement/refunds, TURN relay/media/audio and real Android/iOS hardware
remain pre-release checks. Call signaling success does not prove audio quality.
