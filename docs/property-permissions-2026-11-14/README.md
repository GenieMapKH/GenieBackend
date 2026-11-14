# Property permission incident — 2026-11-14

## Root cause and live repair

Railway production `property` logs at `2026-11-14T12:54:45Z` showed PostgreSQL
`42501 permission denied for table users`, wrapped as Prisma `P2039`, from
`PropertyQueryService.findOwned` during `PropertyLifecycleService.publish`.
The property detail projection loads account email and verification flags.
The running `property_service_1` role could read the ordinary owner card and phone,
but not `email`, `email_verified`, or `phone_verified`.

Applied **only** the existing `51_listing_contact_identity/migration.sql` SQL to
the verified production tenant in a transaction. This grants those three columns
to the parent `property_service` role, preserving rotated-login inheritance.
No table-wide grants, password-hash access, role updates, credential rotation,
application deployment, or production listing/subscription writes were performed.
This was a targeted SQL repair, not a blanket `prisma migrate deploy` or a new
Prisma migration-history entry.

Evidence:
- `production-grants.json`: timestamp, migration SHA-256, denied-before/allowed-after
  column privileges, committed transaction, actual running-role projection success,
  and password-hash read still rejected with `42501`.
- `production-read-probes.json`: actual compiled `PropertyQueryService.findOwned`
  (including relations and engagement counts) and payment-owned
  `SubscriptionService.publishingEntitlements` both passed in read-only transactions.
- Follow-up production permission-error log queries for property, payment and Users
  returned zero entries after `2026-11-14T13:05:15Z`; this is a short observation
  window, not proof of all app flows.

## Regression fix

The subscription integration suite previously replaced the owner query with a
bare property lookup. It never loaded the account relation that failed in production.
It now uses the real `PropertyQueryService` and `PropertyEngagementCounts` under
the restricted property database role, in both direct and queued modes.

New database regressions revoke the three contact grants, verify publishing fails
without changing the draft, apply migration 51, and verify publishing recovers
without granting password reads or role writes. Separate round-trip checks cover
public → archived (`Draft`) → public, free-slot release/reuse, original publish-date
preservation, another owner's denial and capacity enforcement.

Five new lifecycle unit tests cover public posting, archiving, republishing,
payment-pending protection and no writes after an owner-query permission failure.

## Validation

| Command | Result |
| --- | --- |
| `npm test --workspace=property -- --runInBand` | 456 passed; 17 optional integration cases skipped in this invocation |
| `npm test --workspace=payment -- --runInBand` | 110 passed; 25 database cases skipped in this invocation |
| `npm run test:messaging:flows` | 25 subscription/publishing + 11 feed/takeover database cases passed |
| `npm run test:security:integration` | 12 passed; output in `security-integration-tests.txt` |
| `npm run build --workspace=property` | passed |
| `npm run build --workspace=payment` | passed |
| `npm run lint:check --workspace=property` | passed |
| `npm run lint:check --workspace=payment` | passed |
| `git diff --check` | passed |

Existing subscription coverage now runs through the real owner lookup: monthly and
annual plans, concurrent/idempotent purchases, cancellation retaining benefits until
expiry, expiry reconciliation, individual paid listings, renewals, failed persistence
recovery, queued outbox rollback, and financial-history retention.

The first security run failed because the local RabbitMQ fixture was stopped;
after starting it, all 12 cases passed. The disposable security database was removed
by its runner. Both test containers were restored to their original stopped state;
existing volumes and the reusable local flow database were retained.

## Rollback and remaining limits

To undo only this repair, an operator connected to the same verified production
tenant can run the following in a transaction. **It restores the known failure**
for property details and publish/archive operations; it is not recommended as a fix.

```sql
BEGIN;
REVOKE SELECT (email, email_verified, phone_verified)
  ON account.users FROM property_service;
COMMIT;
```

Rollback/recovery was exercised on the disposable local database, not production.
No real bank settlement/refund, device UI flow, external push/email delivery or
Meilisearch integration was tested. Payment integration uses the mock provider and
an in-process service-client bridge; the production payment read probe verifies DB
permissions, not a real checkout or the entire HTTP service-to-service path.
Local test changes remain uncommitted/unpushed. Future releases must apply required
database SQL to the matching tenant before deploying projections that depend on it.
