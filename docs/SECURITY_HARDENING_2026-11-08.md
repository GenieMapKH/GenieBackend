# Account verification and backend hardening

## Deploy

Apply outstanding schema migrations through `39_verified_recovery` before
deploying authentication and user. For a database already at migration 38:

```powershell
node scripts/apply-migrations.js 39_verified_recovery
```

The production form adds `--prod` and reads `.env.prod-db`. No production
migration, credentials change or deployment was performed for this change.
Migration 39 adds email/phone verification flags and a separate, RLS-protected
table for hashed email verification codes. It preserves account data and
leaves legacy contact details unverified because no ownership evidence exists.

Deploy the backend and ship the updated Flutter app together. Older apps can
still log in but cannot register or add an email without the new proofs.
Email delivery and Firebase phone authentication must work before accepting
new registrations. Provider failures never create an unverified account.

## Ownership and recovery

- Phone registration requires a Firebase SMS proof, from the phone provider,
  authenticated within five minutes, matching the submitted number.
- Email stays optional. When supplied, an emailed OTP must be confirmed first.
  Codes expire, are hashed at rest, have resend/guess limits and are consumed
  atomically. Confirmation returns a five-minute address-bound proof that
  cannot be used as an access token or password-reset code.
- `POST /auth/verification/email/request` accepts `{email}`.
  `POST /auth/verification/email/confirm` accepts `{email, otp}` and returns
  `{proofToken}`. `POST /auth/register` now requires `phoneToken` and, with an
  email, `emailProof`, in addition to the existing registration fields.
- Ordinary profile edits refuse phone changes. `POST /auth/account/phone`
  requires `phoneToken` and identity proof (`password` or a fresh Google
  `idToken`). Replacing a number also requires an established device and ends
  the other sessions. The same number can be verified without changing it.
- Adding or verifying an email requires its `emailProof`, the current password
  and an established device. The app exposes verification through Personal Info.
- Password recovery trusts only contacts marked verified. Existing users keep
  password login, but must verify legacy contacts while signed in before those
  contacts can reset their password. A legacy user who has already lost their
  password needs owner-verified support recovery; do not blanket-backfill flags.
- Google login accepts only verified Google email identities. Linking an old
  unverified account removes its unproven phone, discards the old password and
  ends old sessions. Already-linked legacy Google accounts receive the same
  cleanup on their next Google sign-in. This blocks pre-registration takeover.

## Other hardening

- Idle sockets disconnect when their access token expires; timers are not
  serialized into Redis socket data. The app already reconnects with a renewed
  token after a server disconnect.
- Presence subscriptions reject nonexistent targets, are limited per account
  and capped per socket. The cap is checked after asynchronous authorization.
- Photo confirmation locks the listing and rechecks capacity and duplicates
  inside the write transaction. Native image and request parser dependencies
  were updated; CI now rejects high and critical production advisories.
- The gateway ignores forwarding headers by default. When behind a reverse
  proxy, set `TRUSTED_PROXIES` to only its actual IPs/CIDRs and prevent direct
  public access around it. Do not set a blanket hop count or trust all addresses.
  Without this setting, requests behind an ingress share that ingress's limit.
- Compose passes explicit per-service variables. Its six database services
  require their dedicated login URLs; the admin `DATABASE_URL` is never a
  container fallback. JWT encryption/email-provider credentials are confined
  to authentication, Firebase admin credentials to authentication/notification,
  and storage credentials to user/property/chat. The gateway gets neither DB
  credentials nor the internal signing secret. On Railway use service-specific
  variables with the same boundaries, rather than sharing all secrets globally.

Bank payment integration and automated refunds remain separate release work.

## Validation

All eight backend workspaces built; 1,091 backend tests and 26 script tests
passed. Twelve database integration cases were skipped without a test database.
The auth/profile/security Flutter suites passed 117 tests, and the additional
phone-change widget test passed with wrong-code and success paths. Dart analysis
and lint checks for authentication, gateway, chat, user and property passed.
`npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.
Live email/SMS delivery, database migration and container deployment were not run.

## Android CAPTCHA follow-up

The Dart Firebase options still referenced the retired `com.example.genie` app.
They now select the registered Tilomnov app for production and its separate
staging app when `APP_ENV=staging`, matching Gradle and `google-services.json`.
FlutterFire's default metadata also points to the production Tilomnov app.
Configuration tests pass for both environments; auth/phone widget tests pass.

Read-only Firebase checks confirmed phone sign-in and billing enabled, SMS
allowlisted for Cambodia, and the Firebase auth domain authorized. Production
has this PC's debug SHA-1; staging has the release SHA-1/SHA-256 but lacks this
PC's debug certificate. Staging debug installs need that certificate registered;
the release APK path uses the registered release signing key. CAPTCHA is an
expected fallback outside Google Play. The app must be rebuilt/reinstalled to
use the corrected options; the reported rejection and actual SMS delivery still
need retesting on an Android device. No cloud settings were changed.

Device follow-up: the rebuilt staging app was subsequently tested on Android.
The real-number request still returned `17499 / Error code:39` after the
reCAPTCHA fallback; the configured fictional-number/code flow succeeded.
See [device findings and Firebase support draft](FIREBASE_SMS_DIAGNOSIS_2026-11-08.md).
