# Payment, publishing and connection changes — 2026-11-06

## What is implemented

Mock purchases now go through the authenticated payment API and persist in
Postgres. The app never grants a subscription or publishes a paid listing on
its own. There is no bank charge, automatic renewal job or live ABA integration.

Apply `37_subscriptions` before deploying these backend services, including on
a database created from `prisma/prod_schema.sql` (that snapshot stops at 34):

```powershell
node scripts/apply-migrations.js 37_subscriptions
```

For production, use `node scripts/apply-migrations.js 37_subscriptions --prod`.
It requires the production postgres/admin `DATABASE_URL` in `.env.prod-db`;
see [database migration commands](DATABASE_SCHEMAS.md).

Until real payments are integrated, the payment service defaults to
`PAYMENT_MODE=mock`, including for production app builds. Keep the app's
`PAYMENTS_ENABLED` off. A previously configured `PAYMENT_MODE=disabled` must be
changed to `mock` to allow purchases. Setting it to `disabled` stops mock
checkouts and hides stored mock subscriptions and their benefits. Keep staging
and production databases separate. No migration or deployment was run against
the remote database as part of this change.

## API and lifecycle

All public payment endpoints verify an access JWT and take the account ID
from its verified claims, ignoring client account IDs and forwarded headers.

| Method | Path (under `/v1`) | Request/result |
|---|---|---|
| POST | `/payments/subscriptions/checkout` | `{ tier, method, requestId }`; mock returns `{ transactionId, status: 'Success', isSimulation: true }` |
| GET | `/payments/subscriptions/current` | `{ subscription: { tier, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, ... } }`, or `{ subscription: null }` |
| POST | `/payments/subscriptions/cancel` | Sets cancellation on the caller's subscription; does not change tier or paid dates |
| POST | `/payments/checkout` | `{ propertyId, method?, requestId }`; owner-only mock one-time publish, $1 USD |
| GET | `/payments/transactions/:id` | Caller-owned transaction status; another account receives 404 |

`requestId` is a UUID unique per account. Repeated requests return the same
transaction without buying another month. The app retains it after a failed
request until it receives an answer. It is kept in memory; after an app restart,
a completed subscription is reloaded. A new mock purchase reference may buy
any paid tier again. A listing stuck Pending after an interrupted checkout needs its
original reference to resume; automatic abandoned-checkout recovery is deferred
until the bank integration supplies a transaction reconciliation process.

The first paid month starts at the server's purchase timestamp. Its end is
one calendar month later at the same UTC time, clamped to the final day of a
shorter month. Cancellation only sets `cancelAtPeriodEnd` and `cancelledAt`.
Access remains until that exact end time. Reads and publishing checks enforce
expiry without waiting for a scheduled job. The app also reloads at expiry.

Simulation offers every paid plan, including the current and lower tiers.
Each new purchase replaces the current plan with a new full month at the
displayed full price; no proration and no actual charge. The existing success
screen and downloadable receipt are shown after the server saves the purchase.
Receipt emails remain mocked. Renewal and downgrade billing rules must be
implemented before live payments; live app builds still offer upgrades only.
Mock renewal records intent only; no money can move automatically.

The property service asks the payment service over a signed internal request
for its allowance. Create-as-Active, publish and relist all count Active and
Pending listings and write under a per-account Postgres transaction lock.
Exceeding the limit returns 402 with `code: PUBLISHING_PLAN_REQUIRED`. The app
shows the translated request to choose a publishing plan or one-time payment.
Drafts remain saveable. A Pending listing cannot be unpublished or deleted to
escape payment. Only the authenticated payment service can settle it as paid.

## Research and bank integration requirements

[PayWay checkout](https://developer.payway.com.kh/folder-3158159) requires
server-side verification, and its
[check-transaction response](https://developer.payway.com.kh/check-transaction-14530826e0)
includes payment status, amount and currency. Returning from a bank app or
receiving a callback is insufficient proof of payment. Before live checkout,
implement signed purchase requests, verify the stored transaction reference,
APPROVED status, amount and USD currency server-to-server, then settle once.
Add recovery for lost callbacks, refunds and interrupted cross-service writes.
The placeholder adapter now refuses checkout instead of returning a fake URL.

[PayWay scheduled payments](https://developer.payway.com.kh/schedule-payment-2038907m0)
need customer consent and a stored payment token. A monthly KHQR payment alone
does not authorize future deductions. Bank renewal must consult the saved
cancellation flag and coordinate in-flight renewal/cancel operations.
The cancellation behavior follows
[cancel at period end](https://docs.stripe.com/billing/subscriptions/cancel).
Do not enable live payments by changing only a build/environment flag.

## Connection warning

A JSON GET waiting at least 15 seconds triggers an uncached gateway health
check. Three successful health checks each taking at least 5 seconds, spaced
at least 30 seconds apart, establish a slow connection. A quick successful
request resets the evidence; evidence older than two minutes is discarded.
Parallel requests share a check. Uploads, health requests themselves, failed
health checks and cached responses do not count. The warning appears at most
once per 15 minutes while the app shell remains mounted.

These are conservative app policy thresholds, not an industry-defined speed
test. A single slow API handler is no longer sufficient. Gateway latency still
cannot prove the physical internet link is responsible; a stalled gateway can
look similar. This avoids external speed-test traffic or periodic probes while
the connection is good. Android's guidance distinguishes
[network capabilities](https://developer.android.com/develop/connectivity/network-ops/reading-network-state)
and recommends
[throttling network work](https://developer.android.com/develop/connectivity/minimize-effect-regular-updates).

## Verification

Flutter tests cover connection confirmation, parallel batches, quick recovery,
missing publishing selection, checkout, cancellation and reloading purchases.
Backend tests cover prices, month-end dates, expiry, idempotency, ownership,
disabled mock mode and quota checks. The opt-in Postgres integration suite uses
the actual payment/property database roles and verifies concurrent free
publishing, concurrent purchase retries, persisted cancellation and rollback.

To rerun the database suite against a disposable local database with baseline
and migrations 35–37 applied:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:<local-password>@127.0.0.1:<port>/postgres'
npm test --workspace=payment -- --runInBand subscription.integration
```

Do not point this suite at a shared database: it sets test service-role
passwords and temporarily installs a trigger to verify transaction rollback.
