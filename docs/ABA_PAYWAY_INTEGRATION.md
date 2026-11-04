# ABA PayWay integration

Status (2026-11-04): **not integrated.** The app's checkout screens and the
provider abstraction are ready. `AbaPaywayProvider` is still a mock. This page
covers how PayWay works, how it maps onto our code, and what is left to build.

Sources: PayWay developer suite —
[Purchase](https://developer.payway.com.kh/purchase-14530820e0.md),
[Check transaction](https://developer.payway.com.kh/check-transaction-14530826e0.md),
[QR API overview](https://developer.payway.com.kh/folder-3158158),
[Pushback notification](https://paywaydr.ababank.com/developers/payment-success-pushback-notification).
Confirm field details with ABA's integration team before going live, because the two doc sites differ in places.

## The flow

```
App                     payment service              ABA PayWay            ABA Mobile
 │ POST /payments/...checkout ─▶│                          │                      │
 │                              │ create Pending tx        │                      │
 │                              │ POST purchase ──────────▶│                      │
 │                              │◀── abapay_deeplink,      │                      │
 │                              │    checkout_qr_url       │                      │
 │◀─ {transactionId, deeplink,  │                          │                      │
 │    checkoutUrl}              │                          │                      │
 │ open deeplink ─────────────────────────────────────────────────────────────────▶│ user taps Pay
 │                              │◀── pushback (return_url) │◀─────────────────────│
 │                              │ POST check-transaction ─▶│                      │
 │                              │◀── APPROVED              │                      │
 │                              │ settle (publish / activate subscription)        │
 │◀──────────────── user returns to the app (return_deeplink) ─────────────────────│
 │ GET /payments/transactions/:id (polls ~30 s) ─▶ Success                         │
```

Rules:

- **Never trust the app.** The app coming back from ABA Mobile means nothing. A payment is settled only after the pushback **and** a check-transaction call that answers `APPROVED`. PayWay's own docs say the callback alone is not enough.
- **Idempotent settle.** This already exists: `PaymentWebhookService` moves a transaction from Pending to its final state once (`updateMany where status = Pending`). A repeated pushback is answered `alreadyProcessed`.
- **Amount check.** Compare check-transaction's `total_amount` and `payment_currency` with the stored transaction before settling.

## PayWay calls to implement in `AbaPaywayProvider`

All requests are signed: `hash = base64(HMAC-SHA512(PAYWAY_API_KEY, concat(fields…)))`.
Values are concatenated in the documented order, with no separators.

### Purchase → `initiateCheckout`

`POST {PAYWAY_BASE_URL}/api/payment-gateway/v1/payments/purchase` (multipart/form-data).
Sandbox base: `https://checkout-sandbox.payway.com.kh`.

| Field | Value |
|---|---|
| `req_time` | UTC `YYYYMMDDHHmmss` |
| `merchant_id` | `PAYWAY_MERCHANT_ID` |
| `tran_id` | **max 20 chars.** Our ids are 36-char UUIDs, so add a short unique `provider_ref` column (e.g. 20-char base32) and send that |
| `amount` | `PaymentTransaction.amount` (USD, 2 dp) |
| `currency` | `USD` |
| `payment_option` | `aba_pay` and `aba_khqr` → `abapay_khqr_deeplink` (the response then carries both the deeplink and the QR) |
| `return_url` | base64 of our pushback URL, e.g. `https://<gateway>/v1/payments/webhook` |
| `return_deeplink` | base64 of `{"ios_scheme":"tilomnov://payment","android_scheme":"tilomnov://payment"}`. Required for mobile. The app must register this scheme (not done yet) |
| `continue_success_url`, `cancel_url` | optional web fallbacks |
| `lifetime` | minutes; suggest 15 |
| `hash` | fields in this order: `req_time, merchant_id, tran_id, amount, items, shipping, firstname, lastname, email, phone, type, payment_option, return_url, cancel_url, continue_success_url, return_deeplink, currency, custom_fields, return_params, payout, lifetime, additional_params, google_pay_token, skip_success_page` (empty string for fields not sent) |

Response: `status.code` (`"0"` = OK; `1` wrong hash, `4` duplicated tran_id, …), plus `qr_string`, `abapay_deeplink` and `checkout_qr_url`.
Map them to `ProviderCheckout { checkoutUrl: checkout_qr_url, abapayDeeplink, qrString }`.

### Check transaction → `checkTransaction`

`POST {PAYWAY_BASE_URL}/api/payment-gateway/v1/payments/check-transaction-2` (JSON).
Body: `req_time, merchant_id, tran_id, hash`, with the hash over `req_time + merchant_id + tran_id`.
It covers only the last 7 days.

`data.payment_status`: `APPROVED` → `PAID`; `PENDING` / `PRE-AUTH` → `PENDING`; `DECLINED` / `CANCELLED` / `REFUNDED` → `FAILED`.

### Pushback → webhook

PayWay POSTs `{ tran_id, apv, status }` to `return_url` (`status` `0` = success).
The current `PaymentWebhookDto` and HMAC-SHA256 `x-signature` belong to the mock. Replace them with:

1. Accept PayWay's payload.
2. Look up the transaction by `provider_ref`.
3. Call `checkTransaction`, and settle only on `PAID`.

The current webhook route is public (`/payments/webhook` in the gateway's public routes) and must stay public.
Optionally, allow-list PayWay's source IPs if ABA publishes them.

## Our API contract (what the app calls)

| Method | Path | Body | Answer | State |
|---|---|---|---|---|
| POST | `/v1/payments/checkout` | `{ propertyId, method?: 'aba_pay'\|'aba_khqr' }` | `{ transactionId, checkoutUrl, abapayDeeplink }` | **exists** (mock URL) |
| POST | `/v1/payments/subscriptions/checkout` | `{ tier: 'silver'\|'gold'\|'diamond', method }` | same shape | **to build** |
| GET | `/v1/payments/transactions/:id` | – | `{ transactionId, status: 'Pending'\|'Success'\|'Failed' }`, own transactions only | **to build** |
| GET | `/v1/users/me` | – | add `subscription: { tier, expiresAt }` (absent = Free) | **to build** |

The app reads a 404 "Cannot POST …" (endpoint missing), a 501, or `{ code: 'PAYMENTS_DISABLED' }` as "payments not available yet". It shows a friendly message and does not treat this as an error.

## Data model still needed

- `payment_transactions`: make `property_id` nullable, and add `purpose` (`LISTING_PUBLISH` | `SUBSCRIPTION`), `subscription_tier`, `provider_ref` (unique, ≤20 chars), `currency`, `apv` and `paid_at`.
- New `subscriptions` table: `user_id`, `tier`, `status`, `current_period_start`, `current_period_end`, `transaction_id`. One active row per user.
- Plan prices and limits live **on the server**. The app's `PlanCatalog` is display only. App values: Free 1 listing, Silver $5.90 / 20, Gold $8.90 / 50, Diamond $16.90 / 120, one-time publish $1.00, prices include 10% tax. `PUBLISH_FEE` here is still the stub value 50 and must become 1.00.
- Renewal: PayWay checkout is one payment at a time. A monthly plan is either re-paid each month (remind before `current_period_end`), or set up with PayWay's account-linking / credentials-on-file product, which needs ABA's approval. This is a business decision that is still open.

## Enforcement still open (do with the production switch)

The listing limit is not enforced on the server yet. Today you can publish free through `/properties/:id/publish`, `/relist`, by creating with status `Active`, and by unpublishing with no status check (see the security scan notes). The property service must refuse to publish beyond the plan's limit unless a paid one-time transaction backs that listing.

## Switching on

- Server env: `PAYWAY_BASE_URL`, `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY` (secret; never committed).
- App: build with `--dart-define=PAYMENTS_ENABLED=true`. Without it, staging builds publish one-time listings free (as before) and say subscriptions are not available yet.
- Test end to end on the PayWay sandbox (register at `https://sandbox.payway.com.kh/register-sandbox/`) before production.
