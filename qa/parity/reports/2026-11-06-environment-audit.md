# Staging and production audit — 6 November 2026

Checked from 12:56 to approximately 13:02, Asia/Phnom_Penh. This report combines live gateway tests, Railway variables/deployments/logs, read-only database catalog queries, GitHub workflow evidence, and inspection of the relevant source revisions. No platform settings or application source were changed.

## Verified API result

| | Staging | Production |
|---|---:|---:|
| Passed use cases | 75 | 75 |
| Failed / errors / skipped | 0 / 0 / 0 | 0 / 0 / 0 |
| Requests | 359 | 359 |
| Median response | 86 ms | 79 ms |
| 95th percentile response | 226 ms | 179 ms |
| Network retries | 0 | 0 |

Zero differences in the 75 tested outcomes, HTTP/socket responses, and response shapes. Notification device registration/removal, preferences, and admin restrictions pass on both. The previous staging Notification Redis password and missing Authentication internal-secret problems are corrected in the configuration now read from Railway. Notification's startup log confirms it loaded Auth's signing keys.

Detailed test evidence: `2026-11-06T05-59-17-staging-vs-production.md` and its JSON companion in this folder. The suite used only its fixed QA accounts, removed its test files and relationships, and signed out its test sessions. Soft-deleted QA listing rows remain as documented by the suite.

## Findings requiring attention

### 1. Production storage still belongs to staging — confirmed

Production Authentication, Users, property, and Chat have SUPABASE_URL pointing at project `nzurymawikvamjjfbdmz`, the staging project. Their PostgreSQL DATABASE_URLs correctly target production `ovrwutngmsompqpchlgt`. Production data and media are therefore separated inconsistently: live app media operations use staging storage.

Action: inventory and copy production-owned media, retain valid existing links during migration, and move the production storage configuration to the production project. Update the Infisical production folders that feed these Railway services. Changing the URL alone before copying files can break existing media. Do not clear staging storage while production depends on it.

### 2. Production Users is on the previous source revision — confirmed deployment difference; internal-call failure inferred

All seven staging application services report commit `dec5c99`. Six production application services report the same commit; production Users still reports `fec8eb3`.

The old Users internal-account guard verifies Auth's cleanup/visibility tokens with the static JWT_PUBLIC_KEY. The current revision uses JWKS for rotating keys. I compared the configured static Users public key to Auth's currently published keys: it matches none in either environment. Staging runs the updated guard and production's reported revision predates it.

Expected impact: production account deletion can fail when Auth asks Users to remove files, and account visibility cache invalidation can fail. This is an inference from the deployed revision, its source, and the key mismatch; no account was deleted or deactivated to test it. The 75-case suite checks that new devices are refused these actions, rather than performing established-device account deletion.

Action: deploy production Users from the current main commit and confirm its JWKS-based internal guard is running. An ordinary restart of the old image does not update its source.

### 3. Scheduled credential rotation is not operational — confirmed

The latest GitHub Secret rotation run failed before rotation began:
https://github.com/GenieMapKH/GenieBackend/actions/runs/42140867383

Its error is `Set INFISICAL_PROJECT_ID (docs/SECRET_ROTATION.md).` The workflow environment also has empty INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET. The repository secret list lacks these two secrets, and its repository variable list is empty. Production DATABASE_URLs still use the original service-role logins rather than the planned `_1` / `_2` rotating logins; the original service roles remain login-enabled.

Action: finish the machine-identity, GitHub variable/secret, Infisical sync, and bootstrap setup in `docs/SECRET_ROTATION.md`. Set repository variables INFISICAL_PROJECT_ID and INFISICAL_ENVIRONMENT=prod; configure INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET as repository secrets. Complete bootstrap and deployment checks before retiring the old logins. This finding concerns the external credential-rotation workflow; Auth's separate signing-key rotation code is already deployed.

### 4. Real paid publishing remains incomplete in both — confirmed

The app has subscription checkout and transaction-status calls, while both backends still return 404 for `/payments/subscriptions/checkout` and `/payments/transactions/:id`. Both environments allow the suite's free publish path. Payment webhook secrets are also absent from the audited payment-service configuration.

The parity suite intentionally expects these 404s and checks checkout refusals. Its green payment cases do not establish working bank payments, paid subscription activation, receipts, or server-side plan enforcement. If production is expected to enforce paid publishing today, it does not meet that expectation.

### 5. Listing alerts can be lost during dependency downtime — observed error plus source finding

A recent staging property log records a listing-going-live listener failing because Users was unreachable during deployment. `FollowerAlerts` marks `followers_notified_at` before fetching the follower list or calling Notification. `ListingChanges` catches the resulting error and logs it; these paths contain no durable retry for the event. Retrying that listener normally returns early because the listing is already marked notified.

Impact: publishing can succeed while its follower notification is permanently missed. This is a notification reliability issue shared by the source used in both environments; it did not produce a failure in the API parity suite. It needs a focused code change with retry/idempotency handling.

## Additional differences and configuration gaps

- Database targets are correctly distinct. Catalog checks found the same 249 application column definitions in both databases. This check compares column names, types and nullability, not every index, constraint, grant, or data value.
- Staging's six database services use the staging `postgres` administrator login. Production uses the six distinct service logins. Staging therefore does not reproduce production's permission boundaries.
- Internal service secrets and Redis passwords differ between environments, as expected. JWT_KEY_ENCRYPTION_KEY and CHAT_BACKUP_SECRET are identical across the environments. The Firebase project is shared too, consistent with the registered production and staging apps. Environment separation is not complete at the secret/storage level.
- Staging Authentication's variable listing says `PORT=4001 ` with a trailing space, while its latest running log says it listens on 8080 and the gateway targets 8080. It works now, but this discrepancy should be resolved before another deployment. Normalize the intended port to 8080.
- Staging Users/property/Chat/payment AUTH_SERVICE_URL values have leading newlines. Users CHAT_SERVICE_URL has a leading tab in both environments. Current fetches tolerate these values, but remove the whitespace at the configuration source to avoid inconsistent parsing by other tools.
- All 14 latest application deployment manifests have no HTTP healthcheckPath configured. The repository's per-service Railway configuration files are not reflected in those deployment manifests. Configure readiness checks carefully: Authentication currently has no `/health` controller even though its repository Railway file specifies that path. Its JWKS endpoint currently returns 200.
- Production Chat/payment DIRECT_URLs still reference staging. Current runtime database access uses DATABASE_URL, so this is stale configuration rather than a demonstrated runtime crossover.

## Limits

No real phone push receipt, background/terminated-app behavior, WebRTC audio between devices, successful bank payment, real SMS delivery, or destructive established-device account operation was tested. A validated API request or handed-out TURN configuration does not prove device delivery/audio. No production/staging deployments or variables were changed by this audit.

Evidence snapshots in this folder: `2026-11-06T05-56-23-configuration-audit.json`, `2026-11-06T05-58-04-schema-comparison.json`, `2026-11-06T05-59-30-runtime-log-audit.json`, and `2026-11-06T06-01-05-final-deployment-check.json`. Secret values were excluded from these snapshots.
