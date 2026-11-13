# Security remediation - 2026-11-13

## Verdict

**Local remediation is implemented and validated. Production is NOT remediated by this work yet.** All nine F01-F09 audit findings have code changes and regression coverage. H01/H02 and additional database-TLS, CORS, TURN and release-signing hardening are included. Deployment, migrations and broker provisioning were not authorized and were not performed.

This replaces vulnerable outcomes with repeatable regression gates; it is not a promise that future changes can never introduce another vulnerability. The original [2026-11-12 audit](SECURITY_AUDIT_2026-11-12.md) remains the historical baseline, including its originally failing Flutter suite.

Scope: current dirty working trees in `genie-backend` (branch `addon/messagebroker`) and `genie`. Existing search/boundary, UI, artwork and localization work was retained. Nothing was committed, pushed or deployed. Provider credentials were used only for the approved read-only checks. No real payment, user-account mutation, bucket change, credential rotation or provider setup was performed.

## Implemented design and acceptance evidence

| Audit item | Root-cause repair | Regression / negative control |
|---|---|---|
| F09: refresh resurrects an ended session | Rotation, initial issuance and revocation serialize on the same PostgreSQL account row. Consume and replacement insertion share a transaction. Login rechecks the credential/role snapshot under the lock. Logout with an older rotated token ends the entire device session. | Real PostgreSQL latch races against logout-all, device termination and password-reset termination; rotated-token logout preserves the other device. |
| F02: lost Redis markers restore admin access | An active, unexpired refresh row for the matching subject and non-banned/non-deactivated account is the authority. Redis is only a negative hint and disconnect notification. The private auth verification endpoint is checked without a positive cache. Mandatory admin email-link verification remains required. | Empty/lost Redis markers do not restore signed-out users/admins; subject mismatch is denied. Dependency failure cannot grant access. |
| F01: optional public authentication ignores revocation | Shared signed-token/JWT paths verify durable validity; optional public reads fall back to guest with contacts stripped. Protected identity derives from the verified bearer, never unsigned `x-user-id`. Socket handshake/events and idle receivers recheck validity. | Actual property public controllers over HTTP with real RSA-signed tokens: contacts disappear after logout/reset/ban/deactivation. Forged downstream identity headers fail; idle socket disconnects after a missed Redis notification. |
| F03: cross-session Flutter responses/caches | A generation captured before I/O binds responses, retries, refresh-token saves, cache invalidation and kept-copy writes. Login/logout/server sign-out invalidate the generation. Secure-storage writes are serialized; stale work is cancelled rather than replayed as a new account. | Late network/repository responses, old-account 401, same-account new session, and session changes during async ownership lookup cannot save or return old data. Ordinary same-session behavior still works. |
| F04: plaintext chat/profile previews | Kept API copies are bounded session memory, not SharedPreferences. Upgrade/startup/sign-out purge only the six known legacy API-copy prefixes. Attachment disk cache remains encrypted. iOS tokens use device-only unlocked keychain accessibility. | Fabricated message/attachment keys never persist to preferences; upgrade cleanup preserves unrelated settings. Existing same-session offline tests pass. |
| F05: first-password endpoint replaces existing passwords | Verified, matching, fresh Google identity is required. Atomic compare-and-set only changes `hasPassword=false` for the same Firebase UID and active account. Other sessions are ended; existing-password change/reset flows remain separate. | Real concurrent database writes have one winner. Existing password, wrong UID/provider, unverified email, old/future proof and missing proof are refused. |
| F06: recovery contacts become publisher contacts | Public owner summaries omit account phone/email. Publisher profile email is null and phone comes only from an active listing's published contact. Private self-profile remains available to its owner. | Public DTO tests and public HTTP contact-stripping checks; private profile tests remain green. |
| F07: production-default simulation settlement | Missing/unknown mode is disabled. Mock settlement requires explicit `PAYMENT_MODE=mock` outside production, or an explicitly designated staging production build. Simulation propagates into checkout/outcome/receipt UI, is excluded from real income, and does not send a real order receipt. | Environment matrix, server/UI simulation labels, mock receipt suppression and real-provider receipt positive controls. Persisted entitlement/financial-history flows pass. |
| F08: unlimited outstanding upload capabilities | Durable daily worst-case byte/count issuance budgets cover avatars, attachments and listing photos. New listing upload paths have durable reservations, ownership checks and serialized confirmation/cleanup; a failed deletion remains charged. Bucket privacy/limits must be successfully checked at startup. | Concurrent reservation and daily-budget races, expired/unknown path refusal, failed deletion, and attached-photo preservation against real PostgreSQL. |

### Concrete resource limits and tradeoffs

- Listing photos: 30 confirmed plus pending per listing; 60 outstanding per account; 1,024 stored plus pending per account. Reservation lifetime is 130 minutes (the signed upload's two hours plus ten minutes of grace). Cleanup scans up to 100 expired reservations each minute, under the same listing lock used by attachment, deleting only verified unreferenced paths. Cleanup failures retain their charge and retry. Cleaned ledger/daily-budget history is pruned after 30 days.
- UTC daily issuance caps: avatars 20 x 2 MiB; attachments 100 x 12 MiB; listing photos 120 x 8 MiB. A failed signing attempt can still consume a conservative allowance. Limits bound each account's issuance, not total provider spend or abuse across unlimited accounts.
- Session-only copies deliberately sacrifice offline previews after an app restart. Same-session offline previews remain. No existing listings, paid periods, messages or financial history were bulk-deleted.
- Durable verification deliberately sacrifices authenticated availability during auth/database outages. Every accepted authenticated path pays the verification cost; there is no positive cache that could reopen the revocation window. Load/capacity testing remains necessary. Idle sockets have a five-second fallback poll, plus verification/network time, rather than an absolute instantaneous-disconnect guarantee; healthy pub/sub remains faster.
- Outstanding listing uploads created by the old version have no new reservation. Confirmation requires reupload rather than trusting an untracked capability. Automatic deletion of legacy orphans and comprehensive abandoned avatar/attachment cleanup were not introduced; inventory/provider lifecycle work remains necessary.
- Bucket checks fail startup if privacy/limits cannot be ensured. This favors privacy over an apparently healthy service with unsafe storage configuration.

### H01: authenticated broker provenance

`shared/src/messaging/rabbit-transport.ts` now uses one direct source exchange per service, `tilomnov.commands.v1.<source>`. The receiver compares the actual broker delivery exchange with the claimed source. Retry deliveries are accepted only through the receiver's own expired retry path. Payload labels alone are not identity.

`scripts/security/provision-rabbitmq.cjs` prints a plan by default. Its explicit `--apply` requires six distinct 32+ character passwords, creates topology using operator credentials, and gives each application account no configure access, read access only to its main queue, and write access only to its own source exchange/retry/dead queues. Application accounts do not receive broker-admin credentials. Production messaging refuses the old shared username/unmanaged configuration. Compose runs a dedicated bootstrap job before applications; its Docker context includes only this operational script. The bootstrap image was actually built and its non-mutating plan executed locally.

The real broker fixture denies consuming another service, publishing as authentication, direct writes to authentication's queue, and arbitrary exchange creation; a schema-valid forged source is rejected without invoking a handler. Existing burst, duplicate delivery, reconnect, broker restart, retry exhaustion and persistence tests pass. This does not make external provider effects exactly-once after every crash.

### H02: database least privilege

Migration `50_account_column_privileges` removes broad account-table SELECT/UPDATE from non-auth roles and grants only the actual profile/state columns and necessary updates. Non-auth services cannot read password hashes or change roles/passwords. Chat retains its existing chat-key/backup-column access, not authentication-secret access. Avatar/presence writes explicitly select only their required return fields so Prisma does not implicitly request forbidden columns. Real restricted-role queries verify the denial and required profile reads.

### Additional hardening

- **Database TLS:** shared primary/read clients, migration tooling and secret-rotation connections use one verified-TLS policy for public PostgreSQL hosts. URL SSL flags cannot downgrade it. Supabase hosts include the public provider CA alongside system roots, retaining hostname verification. Explicit loopback/private Railway endpoints retain their existing private-network behavior. Provider CA SHA-256: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`; expires 2031-04-26. Revalidate the trust chain before provider CA rotation/expiry; never fix a chain failure with `rejectUnauthorized:false`. Build shared before running operational scripts. `npm run db:migrate:deploy` uses the strict CLI wrapper; direct manual Prisma commands bypass that wrapper.
- **CORS:** exact HTTP(S) origins only, HTTPS in production; malformed/path/wildcard origins fail configuration. Bearer authorization and the client's device-key header are allowed, but identity headers are not. Browser credentials/cookies are disabled. No production allowlist means no browser origin; native mobile HTTP remains unaffected.
- **TURN:** credentials expire in 30 minutes, with a 30-issuance/hour/account budget and refusal before issuing over-budget credentials. This is not a substitute for provider bandwidth/session quotas.
- **Dependencies:** `fast-xml-parser` updated to 5.12.0. The current production npm audit reports zero known advisories; native/mobile transitive advisories are not established by this npm result.
- **Release signing:** Android releases refuse missing signing configuration instead of falling back to a debug key. CI text is consistent with this requirement. The Flutter formatting gate targets source/tests rather than traversing local generated build trees.
- **Regression gates:** backend CI now includes lint, all workspace tests, persisted messaging flows, security integration, dependency audit, schema validation, normal service-image builds and the broker-bootstrap image build. Flutter CI retains analysis, formatting and the full test suite. These edited CI workflows have not been executed on GitHub in this run.

## Approved read-only production observations

Evidence: [provider-inspection.json](security-remediation-2026-11-13/provider-inspection.json), timestamped 2026-11-13. These describe the deployed environment, NOT the locally repaired code.

| Boundary | Verified observation |
|---|---|
| Railway ingress | Gateway alone has `tilomnovgateway.sparkbytekh.com`. Authentication, Users, property, Chat, payment and Notification have no configured public domains or TCP proxies. Redis/RabbitMQ also have none. This is a provider-configuration observation, not proof against every future configuration change. |
| Gateway browser CORS | `CORS_ORIGINS` is unset. Untrusted and `null` Origin preflights receive no allow-origin/allow-credentials headers. Probes returned 404, so those probes alone do not prove route health; source plus HTTP middleware tests establish the intended browser policy. Closed CORS is appropriate for the native-only client; a future web client needs its exact HTTPS origin. CORS is not a firewall or authentication mechanism. |
| Supabase storage | Chat attachments private (12 MiB); avatars public (2 MiB, JPEG/PNG/WebP); property photos public (8 MiB, JPEG/PNG/WebP); ad uploads private and published ads public (5 MiB). Public display assets are intentionally accessible and are not 'hidden APIs'. |
| Supabase API roles | `anon` and `authenticated` have no SELECT-column or INSERT/UPDATE/DELETE grants on the checked account users, refresh tokens and payment transaction tables. This is not a complete audit of every Supabase schema. |
| Production payment mode | `PAYMENT_MODE` is unset. Five existing successful MOCK rows were observed in aggregate with the deployed payment service credential. None was edited/deleted; their existence does not prove five real charges. The old fallback is still a rollout concern until the fix is deployed. |
| Production service grants | Broad grants still exist: user-service can read password hashes and update role/password; property/chat/notification can read hashes. Migration 50 has NOT been applied live. This is a confirmed remaining production exposure, not merely a proposed hardening. |
| PostgreSQL client connection | The approved inspection established TLS with certificate and hostname verification using the deployed authentication/payment URLs and new connection policy. Current URL configuration lacks explicit SSL policy; the new application policy is not deployed. Pooler-session `pg_stat_ssl.ssl=false` describes the pooler-to-database backend leg, not the inspected client-to-pooler TLS socket; it must not be reported as a failed client-TLS check or end-to-end TLS proof. Server enforcement was not changed. |
| Signing-key history H03 | Live JWKS publishes RSA/RS256 and current verifiers restrict that algorithm. The historical Ed25519 private-key file remains in Git history. It was not used to sign/probe anything, and no history rewrite or unknown-consumer key retirement was attempted. Rewriting history alone would not revoke a key. |
| Remaining provider visibility | Railway SSH checks for Redis runtime settings and broker live ACLs were unavailable because no SSH key was registered. No key was registered. Actual Redis eviction/persistence and broker application-account ACLs remain unverified. |

## Validation completed

All commands below exited 0 in this local run. Backend credential-free runners use fabricated identities or explicitly guarded loopback fixtures; the read-only provider inspection is separate.

| Command / check | Result | Evidence |
|---|---|---|
| `npm run build` | Prisma client plus all services compile | `security-remediation-2026-11-13/build.txt` |
| `npm run lint` | All eight workspaces pass | `.../lint.txt` |
| `node scripts/security/test-workspaces.cjs` plus final chat workspace rerun | 151 suites, 1,541 tests pass, zero failures | `.../unit-summary.json`, workspace JSON files |
| `npm run test:scripts` | 38 pass | `.../script-tests.txt` |
| `npm run test:security:integration` | 12 pass | `.../integration-tests.txt`, `.../integration-run.txt` |
| `npm run test:messaging:integration` | 17 pass, including restart and exhausted retries | `.../messaging-tests.txt` |
| `npm run test:messaging:flows` | 21 payment and 11 property persisted-flow tests pass | `.../messaging-flows.txt` |
| `npm audit --omit=dev --json` | 0 known production advisories | `.../npm-audit.json` |
| Prisma schema validation | Valid | `.../prisma-validate.txt` |
| Broker-bootstrap Docker build and dry plan | Image built; six ACL plans; `applied:false` | `.../docker-bootstrap.txt`, `.../broker-permission-plan.json` |
| `flutter test --no-pub --reporter json --timeout 60s` | 1,502 visible tests pass, no skips/failures | `../../genie/docs/full_test_verified_2026_11_13.jsonl` |
| `flutter analyze --no-pub` | No issues | `../../genie/docs/analyze_security_2026_11_13.txt` |
| `dart format --output=none --set-exit-if-changed lib test` | 801 files, no changes required | `../../genie/docs/format_security_2026_11_13.txt` |

The final formatting-only pass was followed by focused security/auth/payment tests and analysis. Intermediate failed/debug artifacts are not final acceptance evidence. Integration logs contain expected negative-control/dead-letter messages; a log's error-level label alone is not a failed test.

Cleanup was verified: the newly created security database and unique RabbitMQ fixture users/vhosts were removed. The two previously stopped messaging test containers were stopped again; their pre-existing volumes were preserved. Fixture data stays local. Production mutations remain zero. See `.../cleanup.json`, `.../fixture-stop.txt`, and `.../fixture-final-state.jsonl`.

## Deployment runbook - requires separate approval

Prefer a brief controlled maintenance window over a mixed-version security cutover. Do not blindly push this dirty workspace: review/stage the intended security files separately from existing user work. The source does not automatically migrate Railway databases.

1. Establish a restorable database backup and record current deployed versions/configuration securely. Verify operational access to the broker and credential store; do not expose passwords in logs/reports. Recheck ingress. Explicitly select `PAYMENT_MODE=disabled` for production until a real bank adapter is implemented and verified. Existing paid periods/history remain intact.
2. Apply additive migration `49_upload_reservations` before new upload services start, using the correct database administrator connection and strict TLS tooling. Build shared first. Rehearse on staging; schema/source drift from other branches must be resolved, not overridden.
3. Drain existing broker outboxes/queues using the old revision, then stop producers/workers for the cutover. Preserve dead letters; do not purge or fabricate receipts. Old shared-exchange messages are incompatible with strict new source provenance. If draining cannot be proven, postpone cutover and prepare a reviewed replay/conversion procedure.
4. Explicitly provision source topology and six scoped broker accounts with the operator-only script. Set each service's own URL and `RABBITMQ_MANAGED_TOPOLOGY=true`, using secret channels. The script's `--apply` changes provider state and has NOT been run against production. Verify real denies, not merely an expected username. Keep gateway off the broker.
5. Deploy authentication first and verify `/internal/sessions/verify` privately. Deploy all remaining services and gateway from the same reviewed revision/configuration. Health alone does not prove private route connectivity, bucket readiness, session correctness or message flow. Old clients without a durable session identifier must renew/sign in.
6. Apply migration `50_account_column_privileges` **after all non-auth services use explicit safe selects**. Applying it before replacing old avatar/presence code can break those operations. Verify active rotating-login inherited grants, positive business flows and negative secret/role writes. Leave additive migration 49 in place.
7. In staging first, then with approved test accounts in production: replay sign-out/reset/admin-link tests, public contact stripping, direct forged-header denial, new photo issue/confirm/cleanup, avatars/attachments, broker delivery/retry, missing/mock payment refusal, and normal existing entitlements. Test the app update, secure storage, background/reconnect, encrypted attachments and actual devices on Android/iOS. Verify provider costs/quotas and realistic load before reopening traffic.
8. Rollback is a coordinated application/configuration rollback, not a destructive schema rollback. Stop new traffic first, preserve outboxes/financial rows, record rollback versions, and keep the additive upload ledger. Do not silently grant old broad privileges, shared broker admin access, unverified TLS or mock production settlement to make an old build start. Any emergency privilege restoration is a separate explicit risk decision. Production rollback has not been exercised here.

## Still not established

No production deployment/migration/provisioning, real ABA settlement/callback/refund, live push/email delivery, TURN traffic/billing, production load/chaos test, full cloud-IAM audit, device backup/restore test, signed release APK or all seven service runtime Docker images were validated here. The ABA live adapter remains unfinished/fail-closed. Legacy object inventory/retention, provider-wide cost caps and historical-key consumer inventory remain operational follow-ups. Readiness must not be inferred from this report's existence.

## Primary design references

- [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html): durable serialization rather than a process-local mutex.
- [RabbitMQ access control](https://www.rabbitmq.com/docs/access-control): scoped broker resource permissions.
- [Supabase signed upload URLs](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl): capability lifetime must be covered before cleanup.
- [node-postgres TLS](https://node-postgres.com/features/ssl) and [Supabase SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement): URL flags can replace TLS configuration; chain/hostname verification is retained.
