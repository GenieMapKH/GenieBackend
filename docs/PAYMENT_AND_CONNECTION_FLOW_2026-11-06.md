# Payment, publishing and connection changes — 2026-11-06

## What is implemented

Mock purchases now go through the authenticated payment API and persist in
Postgres. The app never grants a subscription or publishes a paid listing on
its own. There is no bank charge, automatic renewal job or live ABA integration.

Apply `37_subscriptions` and `38_payment_checkout_period` before deploying these backend services, including on
a database created from `prisma/prod_schema.sql` (that snapshot stops at 34):

```powershell
node scripts/apply-migrations.js 37_subscriptions 38_payment_checkout_period
```

For production, use `node scripts/apply-migrations.js 37_subscriptions 38_payment_checkout_period --prod`.
It requires the production postgres/admin `DATABASE_URL` in `.env.prod-db`;
see [database migration commands](DATABASE_SCHEMAS.md).

Until real payments are integrated, the payment service defaults to
`PAYMENT_MODE=mock`, including for production app builds. The app uses
the common checkout client (the old `PAYMENTS_ENABLED` app switch has been removed). A previously configured `PAYMENT_MODE=disabled` must be
changed to `mock` to allow purchases. Setting it to `disabled` stops mock
checkouts. Existing paid benefits remain until their saved expiry, including when the provider changes. Keep staging
and production databases separate. No migration or deployment was run against
the remote database as part of this change.

## API and lifecycle

All public payment endpoints verify an access JWT and take the account ID
from its verified claims, ignoring client account IDs and forwarded headers.

| Method | Path (under `/v1`) | Request/result |
|---|---|---|
| POST | `/payments/subscriptions/checkout` | `{ tier, method, requestId, quote }`; mock returns `{ transactionId, status: 'Success', isSimulation: true }` |
| GET | `/payments/subscriptions/current` | `{ subscription: { tier, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, ... } }`, or `{ subscription: null }` |
| POST | `/payments/subscriptions/cancel` | Sets cancellation on the caller's subscription; does not change tier or paid dates |
| POST | `/payments/checkout` | `{ propertyId, method?, requestId }`; owner-only mock one-time publish, $1 USD |
| GET | `/payments/transactions/:id` | Caller-owned transaction status; another account receives 404 |

`requestId` is a UUID unique per account. Repeated requests return the same
transaction without buying another month. The app retains it after a failed
request until it receives an answer. It is kept in memory; after an app restart,
a completed subscription is reloaded. An active subscription can only upgrade to a higher tier; same-tier and downgrade purchases return 409. An expired account can buy any paid tier. The same checkout reference always returns or resumes its original transaction. A listing stuck Pending after an interrupted checkout needs its
original reference to resume; automatic abandoned-checkout recovery is deferred
until the bank integration supplies a transaction reconciliation process.

The first paid month starts at the server's confirmation timestamp. Its end is
one calendar month later at the same UTC time, clamped to the final day of a
shorter month. Cancellation only sets `cancelAtPeriodEnd` and `cancelledAt`.
Access remains until that exact end time. Reads and publishing checks enforce
expiry without waiting for a scheduled job. The app also reloads at expiry.

The app uses one checkout client for all providers. The server creates a
Pending payment and only publishes a listing or activates a subscription after
`PaymentGatewayService` checks the provider's transaction ID, amount, USD currency
and final status. Both callbacks and authenticated status polling enter this
shared settlement path. Settlement and subscription writes run under a per-account
transaction lock. Listing fulfillment is idempotent, and a failed remote write
leaves the payment Pending for a safe retry.

Subscription checkout first requests `GET /payments/subscriptions/quote/:tier`.
The server signs an account- and tier-bound price quote valid for five minutes.
Submit its `quote` token with the checkout request. New plans cost the full
monthly price and start when payment is confirmed. Upgrades cost the difference
between monthly prices, multiplied by the fraction of the billing period left,
rounded to cents (minimum one cent). Upgrades preserve the original start/end
and cancellation choice. Price changes or quote expiry require the user to
review again; a checkout retry uses its originally saved amount. At most one
subscription payment per account can be Pending.

Order confirmation emails are sent after commit through a signed
payment-to-authentication request. Authentication uses the saved account email
and its existing Brevo/Resend/SMTP configuration. Deploy both services; payment
needs `AUTH_SERVICE_URL` and the matching `INTERNAL_SERVICE_SECRET`, also used to
sign price quotes. Delivery failures are logged and do not roll back payment.
No mail outbox, automatic retry or historical backfill exists yet. One-time listing confirmations use the same backend delivery.

The default provider remains `MOCK`: only the provider is simulated; the app
has no simulation-specific pricing, grant logic or messages. `PAYMENT_MODE=live`
selects the ABA adapter, which fails closed until purchase and verification
calls are implemented. Removing test wording does not enable bank charges.
There is no automatic bank renewal. Downgrades become available after expiry;
recurring renewals and scheduled downgrades need provider consent/tokenization.
See [current gateway handoff](PAYMENT_GATEWAY_HANDOFF.md) for implementation and
verification still required before live payments.

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
