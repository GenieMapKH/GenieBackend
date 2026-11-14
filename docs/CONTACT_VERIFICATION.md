# Contact verification ? optional identity signals

Updated policy: signup, listing creation/editing/publication, and subscriptions
must not depend on successful SMS delivery. A valid phone is still required for
password signup and a callable contact for public listings. Google login still
requires a valid, verified Google token; it verifies email, not phone.

Password signup without phoneProof stores phone_verified=false and
email_verified=false. An optional supplied phoneProof is strictly validated;
invalid proofs are rejected, never silently converted to verified contacts.
Existing password and admin email-link login remain unchanged. OTP remains
available from account/contact verification controls; failures do not gate posting.

Individual property details carry owner email, phone, emailVerified and
phoneVerified. Buyers see each contact with Verified or Not verified. Different
listing contact numbers do not inherit the account number's badge. Guests and
rate-limited contact reveals retain the existing privacy filtering; bulk feed/map
cards do not expose account contacts. Verification is not a seller endorsement.

Publishing still enforces valid contact formatting, ownership, publishing quota,
listing status, takeover validation, and actual payment state. Active listings
continue to appear in the feed regardless of verification. Pending/Draft listings
are not made public just by bypassing verification. Paid settlement no longer
rechecks SMS, so existing Pending payments are not stranded by OTP failure.

## Mock subscriptions

PAYMENT_MODE=enabled or mock explicitly selects mock testing, including a
production-runtime test deployment. Missing, disabled and unknown values deny
mock checkout. PAYMENT_MODE=live retains the live-provider path. Mock settlement
and idempotency checks remain server-owned. Never use test mode for real billing:
mock subscriptions confer benefits without a real charge.

## Rollout

Apply migration 51_listing_contact_identity before deploying the Property detail
select. It grants only email and verification-column reads to property_service;
password hashes remain inaccessible. Deploy Authentication, Property and Payment
changes together with an updated Flutter build. Existing applied migration 50
is unchanged. No production database grant, environment update or deployment was
performed as part of local implementation. Real device OTP and payment delivery
remain separate checks.

## Local verification for this implementation

- Property: 451 passed; 17 pre-existing skipped.
- Authentication: 286 passed.
- Payment: 110 passed; 21 pre-existing skipped.
- Flutter auth/contact/identity/payment regression selection: 45 passed.
- Property, Authentication and Payment builds and lints passed.
- Flutter analysis passed.
- Database security integration could not start: the isolated PostgreSQL fixture
  at 127.0.0.1:55439 refused the connection. Migration 51 is therefore prepared,
  not live-applied or database-integration verified.
- Logs: docs/optional-verification-*.txt in each repository.

Release sequence: apply migration 51, deploy the three backend services, set
PAYMENT_MODE=enabled or mock only on the intended test deployment, then distribute
an updated Flutter build. Verify an unverified user can sign up, create an Active
listing visible in Feed, edit it, and complete a mock subscription. Verify contact
badges with a signed-in buyer and that guests still receive no contact values.
Do not republish Draft/Pending listings or create new charges to repair old payments.
