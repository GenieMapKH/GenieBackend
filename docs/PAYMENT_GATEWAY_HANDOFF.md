# Payment gateway handoff

The app and payment service now use the same pricing and entitlement lifecycle
regardless of provider. The default bank substitute is `MockPaymentProvider`;
all grants still require the shared verification/settlement service. This is
not an implemented live ABA integration.

## Deploy this change

Apply migration `38_payment_checkout_period` before deploying payment (and
`37_subscriptions` first if missing):

```powershell
node scripts/apply-migrations.js 38_payment_checkout_period
# Production, using the admin URL in .env.prod-db:
node scripts/apply-migrations.js 38_payment_checkout_period --prod
```

The migration adds the chosen payment method, quoted subscription billing dates
and a unique index allowing one Pending subscription checkout per account.
It preserves existing successful payments and subscriptions. No production
migration or deployment was performed as part of this implementation.

Deploy payment and authentication, then ship the app. Keep the payment service's
`AUTH_SERVICE_URL` and `INTERNAL_SERVICE_SECRET` configured. Existing provider
credentials stay on authentication. There is no app `PAYMENTS_ENABLED` switch;
the server returns either a completed checkout or bank payment links. Internal
provider labels remain available for traceability, while test messages have
been removed from checkout and confirmation emails.

## Rules implemented

Expiry enforcement also runs in the property service at startup and between
scans with a 30-second delay. It keeps the oldest Active listings within the
account's current allowance and changes the excess to Draft, retaining their
data. Migration `45_monthly_listing_access` gives each successful one-time
purchase one calendar month of access from confirmation (UTC, clamped at month
end). Its `listingPeriodEnd` is stored with the payment; old successful
payments are backfilled using their paid date, or their last recorded timestamp.
Those listings do not consume plan slots during their paid month. After expiry,
they can use an active subscription's capacity; otherwise they become Draft and
require another payment, even if the free slot is empty. The oldest ordinary
free listing remains available. Pending one-time
payments also protect an already Active listing for up to a month from checkout:
verified remote publication can precede the payment transaction's final commit.
A pending listing remains
hidden and cannot be activated by this cleanup. The worker invalidates public
caches and search through ListingChanges. It locks payment changes before
publishing changes so renewal, upgrade and expiry cannot apply conflicting
snapshots. Deploy payment before property, because cleanup uses the new
property-service-only `/internal/subscriptions/:userId/publishing` endpoint.
Cleanup is asynchronous: scan time and outages can delay expiry; failures are
logged and retried without hiding listings based on an unknown plan.

Payment's reminder worker checks every minute for subscription and individual
periods ending within three days. It records delivery per period, serializes
against purchases, and retries failed delivery. Renewed or subscription-covered
individual periods are skipped. The notification service sends localized
English/Khmer pushes through the existing listing-alert channel; opening them
leads to My Properties or subscription plans. Delivery requires registered push
devices and configured Firebase. The app opens the shared renewal checkout when
an owner tries to activate a property requiring payment, or when it sees an
expired subscription at sign-in/resume/foreground expiry. Dismissing checkout
does not activate a listing; only provider-verified settlement grants access.
`GET /v1/payments/subscriptions/expired` returns the authenticated account's last
expired subscription, or null while it has an active period. The renewal sheet
can also open subscription plans to cover an individual post within the plan's
capacity.

Rollout: apply migrations 44 (financial retention) and 45 first, deploy
Notification, Payment, Property, then Flutter. Set `NOTIFICATION_SERVICE_URL`
on Payment. Existing expired one-time posts can move to Draft as soon as the
updated Property worker starts; their financial records are preserved.

A verified upgrade payment confirmed at or after its original period end is
saved as RefundRequired with paidAt, without granting access or sending a
success email. Repeated confirmation is harmless. The app displays a localized
refund message and the transaction reference. Support must process the refund;
automated bank refunds remain part of the live provider integration.

- New/expired accounts: any paid tier, one full calendar month from confirmation.
- Active accounts: higher tiers only. Charge the prorated monthly price difference
  for the remaining time, rounded to cents (minimum USD 0.01). Keep billing dates.
- Same-tier and early downgrade purchases are rejected on the server and hidden
  in the app. Lower tiers can be purchased once the current period has expired.
- Five-minute signed quotes bind the price to the account, target tier and current
  subscription transaction. The app shows and submits that quote, then uses the
  confirmed server amount/time for receipts.
- Pending/failed payments grant no new entitlement. The existing paid plan stays
  active while an upgrade is pending or fails. Cancellation retains paid access,
  and an upgrade does not silently switch cancellation off.
- Idempotent requests preserve the agreed amount; final payments are never
  downgraded by late callbacks. Polling and callbacks use provider verification.
- Disabling checkout or changing provider does not erase paid access.

## Provider integration still required

Implement `AbaPaywayProvider` behind `PaymentProvider`:

1. `initiateCheckout` must create or resume the same transaction ID idempotently,
   returning real bank links. Persist a unique short ABA reference (ABA's ID size
   differs from our UUID) and map it back to our transaction.
2. `checkTransaction` must call the bank, normalize PAID/PENDING/FAILED, and return
   the bank-verified amount/currency and our mapped transaction ID. Never echo
   requested values as evidence of payment; only the mock provider does that.
3. Adapt `/payments/webhook` to ABA's callback payload and authentication. The
   current normalized DTO/signature belongs to the mock, and the live adapter
   refuses it. The callback is a signal to verify directly with the bank.
4. Register mobile return links and test app resume, browser fallback and timeout.

Before enabling `PAYMENT_MODE=live`, verify on the bank sandbox: approved,
declined, cancelled, wrong amount/currency, duplicate/concurrent callbacks,
lost responses, delayed confirmation, unavailable property service and app restart.
Complete reconciliation for abandoned Pending payments, bank refunds for late
upgrades, refunds/chargebacks and provider changes with
outstanding payments. The app retains retry references in memory only; pending
recovery after restart and expired bank checkout recovery remain necessary.
Subscription email delivery is best effort and needs a durable outbox for
reliable retries. One-time listing and subscription order confirmations both use backend delivery.
Recurring billing, automatic renewal and scheduled downgrades need explicit
provider consent/tokenization and are not implemented.

Unit/API/widget tests exercise the common rules with deterministic provider
substitutes. They cannot establish live-bank compatibility or a 100% success rate.
See [ABA integration notes](ABA_PAYWAY_INTEGRATION.md) for the merchant API work.
