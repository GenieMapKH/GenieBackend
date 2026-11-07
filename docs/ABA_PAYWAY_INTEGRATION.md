# ABA PayWay integration

Status (2026-11-06): **bank integration not implemented.** Mock purchases now
persist in Postgres and the server enforces publishing limits. The ABA adapter
refuses live checkout. See [the implemented lifecycle and deployment settings](PAYMENT_AND_CONNECTION_FLOW_2026-11-06.md).
The provider instructions below describe the work still needed for real payments.

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

## Implemented API and enforcement

See [Payment and connection flow](PAYMENT_AND_CONNECTION_FLOW_2026-11-06.md)
for the current mock API contract, migration 37, expiry, cancellation,
idempotency and publishing enforcement. Subscription state comes from
`GET /v1/payments/subscriptions/current`, not `/users/me`.

## Remaining work before live payments

- Implement the purchase and verification calls above with ABA merchant credentials.
- Add a unique provider reference of at most 20 characters and store ABA's approval reference.
- Verify approved status, amount and currency against the stored transaction.
- Implement reconciliation for lost callbacks and interrupted publishing, refunds and renewal consent.
- Implement credential-on-file renewal and provider cancellation, respecting the stored cancellation flag.
- Verify the complete flow on ABA's sandbox before enabling live payments.

`PAYMENTS_ENABLED=true` alone cannot enable bank payments. Server checkout
currently defaults to mock mode in every app environment, persists provider
`MOCK` and never charges. Set `PAYMENT_MODE=disabled` on the payment service to
stop simulated purchases and benefits. The placeholder provider returns no
payment URLs.
