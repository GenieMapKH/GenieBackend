# Signup and publishing contact verification

Implemented locally, 2026-11-13. No deployment or live SMS test performed.

## Rules

| Signup contacts | Required before account creation | Stored verification |
| --- | --- | --- |
| Phone only | Firebase SMS OTP | Phone verified |
| Email only | Existing email OTP | Email verified; phone absent |
| Phone and email | Firebase SMS OTP only | Phone verified; email unverified |
| Google OAuth | Existing verified Google sign-in | Email verified; phone not automatically verified |

Verification happens during signup, not on every later password login. Existing
accounts remain able to log in. Admin email-link login remains unchanged.

Unverified signup email can be verified under Account Settings -> Personal Info ->
Verify email, using the existing email OTP, password confirmation and established
device protection. Until then it cannot receive password-reset codes or be used
to auto-link Google into a phone-verified account.

## API contracts

- `POST /auth/register`: optional `phone` and `email`, at least one required;
  existing `password` and optional `name`. When `phone` exists, `phoneProof` must
  be a Firebase ID token from a phone sign-in for that exact normalized E.164
  number, authenticated within 5 minutes. Otherwise `emailProof` is required.
  A supplied email proof never substitutes for phone proof.
- `POST /auth/account/phone/verify`: authenticated app session, body
  `{ "phone": "E164_NUMBER", "phoneProof": "FIREBASE_ID_TOKEN" }`. Verifies and
  saves the first/current account number. A different existing account number
  must be changed using the existing protected Account Settings flow first.
  Duplicate phone ownership is rejected. A conditional write rejects a phone
  changed while verification was in flight.
- Firebase proof is checked server-side, including revocation. SMS credentials
  cannot be exchanged through the Google login endpoint for an app session.

## Create Property

The contact section has **Verify phone by SMS**. Pressing Publish also opens that
verification when the account has no verified phone, before upload/payment begins.
After verification the account profile refreshes; subsequent listings do not
need another OTP while that account phone stays verified. Changing the account
phone clears verification as before. Private drafts do not require verification.

The property backend enforces `phoneVerified`, independently of Flutter, on
direct Active creation, publishing/relisting, live/pending edits, payment start
and paid settlement. Ordinary contact formatting and optional extra listing
numbers remain unchanged: this verifies the account, not every listing contact.

## Rollout and checks still required

- No schema migration added: nullable phone/email and verification flags already
  exist in the Prisma schema. No database changes were applied by this task.
- Coordinate the new Flutter release with authentication and property services.
  Older clients cannot satisfy phone signup proof or the new publishing gate.
- Review/drain existing Pending publication payments before enabling the gate:
  settlement rechecks verification, so an old unverified account may need SMS
  verification before its paid listing can go live. Do not drop payment records
  or blindly retry charges. No production payment state was inspected here.
- Real-device staging checks: phone-only signup, email-only signup, both contacts,
  incorrect/expired code, resend, Android automatic verification, cancellation,
  later email verification, and Google signup -> first property verification.
- Confirm Firebase Phone provider, SMS regions/quota/billing and correct app
  signing fingerprints (including Play App Signing and the staging package).
  iOS additionally needs its Firebase/APNs/reCAPTCHA setup verified on a device.
  No SMS-reading permission is added.

References: [Flutter phone authentication](https://firebase.google.com/docs/auth/flutter/phone-auth),
[Admin ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

## Local checks

- Authentication workspace: 21 suites / 284 tests passed.
- Property workspace: 49 suites / 448 tests passed, 17 existing tests skipped.
- Flutter targeted auth/security/property checks: 63 tests passed.
- `flutter analyze --no-pub`: no issues.
- Authentication and property builds passed.
- Authentication lint and targeted Prettier checks passed.
- New English/Khmer strings passed key-presence and Khmer Unicode checks.

These are local automated checks, not production delivery verification.
