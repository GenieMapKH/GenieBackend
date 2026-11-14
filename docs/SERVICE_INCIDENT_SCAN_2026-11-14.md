# Production service incident scan — 2026-11-14

## Scope

Read-only inspection of Railway production in project `6c31c542-9708-4453-854b-3bc730744229`.
Queried the last 24 hours of error-level deployment logs for Authentication,
property, Users, payment, Gateway, Notification and Chat, bounded to 120 lines
per service. Queried gateway HTTP failures separately, bounded to 150 server
errors. This is incident triage, not exhaustive security or load testing.

## Confirmed blockers

### 1. Property creation and publishing fail on a missing column grant

Gateway logs show HTTP 500 on publishing at 15:19 Cambodia time, and creation
at 16:08 and 16:23. Property logs identify:

```
42501: permission denied for table users
requireListingContact -> PropertyLifecycleService.create / setStatus
```

The helper explicitly selects `phone` and `phoneVerified`. Migration
`50_account_column_privileges` grants Property `phone`, not `phone_verified`.
Read-only inspection using the deployed service's actual `DATABASE_URL` confirms:

```json
{"role":"property_service_1","phone":true,"phone_verified":false,"password_hash":false}
```

This fails before a listing write or allowance consumption in the direct Active
creation path. Verified and unverified owners both encounter the permission
failure before verification can be evaluated.

Repair: add a new migration, rather than edit applied migration 50:

```sql
GRANT SELECT (phone_verified) ON account.users TO property_service;
```

Verify with the runtime role that the column becomes readable and password hashes
remain inaccessible. Then retry creation/publishing with a verified account and
confirm an unverified account receives PHONE_VERIFICATION_REQUIRED, not HTTP 500.
No grant, migration, account change, or deployment was executed during this scan.

### 2. Subscription checkout is deliberately disabled

Gateway logs show three HTTP 501 responses on
`/v1/payments/subscriptions/checkout` at 16:20 Cambodia time. Live payment service
configuration reports `PAYMENT_MODE=disabled`. The subscription service calls
`requireMockPayments()` outside live mode, which emits PAYMENTS_DISABLED.
This is independent of SMS OTP. Do not enable production mock payments as a repair.
Local ABA PayWay provider methods still throw NotImplementedException; changing
the mode to live alone is not a completed payment integration.

### 3. SMS delivery remains a separate unresolved client/provider failure

Flutter requests SMS directly through Firebase `verifyPhoneNumber`, not Railway.
The screenshot does not contain the Firebase error code. The current error mapper
collapses unrecognized Firebase errors into the generic SMS-unavailable message.
The earlier readiness document explicitly left Play signing, billing and real
carrier delivery unverified. No connected device is available in this session.
Do not infer a certificate mismatch or disable verification without evidence.

## Verification gates and rollout effects

- Google login verifies email, not phone.
- Active creation, publication/relisting, Active/Pending edits, payment publication
  start and paid settlement call the phone gate.
- Flutter Publish requests phone verification before uploads/payment if the profile
  is unverified. Private drafts do not require it in the lifecycle create method.
- Existing unverified users therefore cannot publish until SMS works.
- Pending paid listings can remain blocked at settlement. Preserve payment records;
  reconcile affected listings without retrying charges blindly.
- Local CONTACT_VERIFICATION.md says the newest required-phone password signup
  policy is not deployed; local behavior must not be assumed to match installed builds.

## Other services

No error-level entries were returned for Authentication, Users, payment, Gateway,
Notification or Chat in the bounded deployment-log query. This does not establish
end-to-end health: expected 4xx/501 exceptions may not produce error-level logs.
Authentication also logs one undecryptable signing key retained for verification;
this scan does not link it to failed logins.

## Evidence limitations

An initial database probe selected PROPERTY_DATABASE_URL and returned 28P01.
Source inspection shows PrismaService actually consumes DATABASE_URL; retrying
that exact deployed variable succeeded and produced the privilege evidence above.
The failed probe does not prove deployed database credentials are broken.

No live SMS, Google/password login, payment or property write was performed.
No source code, provider configuration or production data was changed.
