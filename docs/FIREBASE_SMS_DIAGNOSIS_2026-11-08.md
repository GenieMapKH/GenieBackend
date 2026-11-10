# Android SMS verification: device findings

Update 2026-11-09: signup no longer requests or requires SMS verification while
delivery is unreliable. New registrations without SMS proof store the phone as
unverified; phone validation and optional email ownership checks remain enforced.
Deploy the authentication change before shipping the updated app. Older clients
may still submit a valid SMS proof. The existing Firebase verification code is
retained for later reintroduction. Phone-only accounts created without proof
cannot use phone password recovery until they verify a recovery contact while
signed in. This change does not resolve the delivery issue described below.

Tested on the connected Android 17 phone on 2026-11-08, using the rebuilt,
release-signed staging app (`com.sparkbytekh.tilomnov.staging`). The existing
production app and its data were preserved. No passwords were changed.

## Observations

- The supplied real Cambodian number failed before reaching OTP entry.
- Firebase logged status `18002`: `Invalid PlayIntegrity token; app not
  Recognized by Play Store`, then retried using its reCAPTCHA fallback.
- The Firebase web page returned to the app. The SDK subsequently logged
  status `17499`, `Error code:39` (also observed at device time 17:50:54).
- The same installed app accepted the project's configured fictional phone
  number and test code, signed in to Firebase, obtained its proof, signed out
  and opened the new-password screen. The test stopped before password entry.
  This control sends no real SMS and does not establish actual delivery or
  independently prove that real-number CAPTCHA verification succeeded.
- The installed app used the corrected staging Firebase app ID. No testing
  verification bypass was enabled in this app.

Phone sign-in and billing were confirmed enabled, Cambodia (`KH`) was on the
SMS allowlist, and the Firebase auth domain was authorized. The staging app
has registered release SHA-1/SHA-256 fingerprints. Its missing local debug
certificate does not explain this test with the release-signed APK.

## Firebase support draft

Project: `genie-a0c66` (`67344886415`). Android Firebase app:
`1:67344886415:android:87f852fd2445a72b60defa`.

Real-number phone verification fails with `17499 / Error code:39` after the
browser reCAPTCHA fallback. Configured fictional-number verification succeeds
through the same installed app. Please investigate server-side SMS eligibility,
quota/abuse decisions and any project or destination-carrier restrictions, and
identify the specific reason for this refusal. The project owner can supply
the tested number privately through the support case.

Client logs alone do not establish the precise cause. No support request was
sent and no Firebase settings were changed during diagnosis.
