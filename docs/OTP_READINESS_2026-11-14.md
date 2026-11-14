# OTP readiness check — 2026-11-14

## Verdict

Ready for a signed release-APK device test. An actual SMS delivery success rate
cannot be measured without testing real delivery and completing the device flow.
No application changes or provider-setting changes were made during this check.

## Verified live, without sending SMS/email

- Firebase Phone provider enabled for `genie-a0c66`; SMS region allowlist is `KH`.
- Production Authentication uses the same validated Firebase credential/project.
- Admin account-read permission works, as required for revoked-token checking.
- Local release keystore SHA-1 and SHA-256 match Firebase for both production
  and staging package names. Debug staging fingerprints do not match; production
  debug SHA-256 is missing. Use the release build for this test.
- Production Brevo API credential accepted; the configured email sender is active.
  Local SMTP connection/authentication also passed. No email was sent.
- Production database matches the inspected configured database. The email OTP
  table exists. One Pending listing has an unverified owner and one Pending
  payment record; its owner must verify before publication can settle/go live.
  No payment/listing/user rows were changed.
- Production gateway health: HTTP 200. Phone verification endpoint rejects an
  unauthenticated request with HTTP 401.

## Merge and deployment

- Existing PR #49 is merged: https://github.com/GenieMapKH/GenieBackend/pull/49
- Main commit: `c55f31613f84dd6b899889a115a9c8dcf37a645e`.
- Merged file content matches the checked backend checkout.
- Railway production Authentication, property and Gateway deployments report
  SUCCESS on that commit. This is deployment evidence, not an OTP end-to-end test.
- GitHub Actions run 43563634924 was still running at the last observation;
  no claim of a completed cloud CI run is made here.

## Fresh local checks

- All backend services build and lint passed.
- Backend workspace tests: 1,574 passed, 38 existing skipped; script tests: 44 passed.
- Flutter targeted auth/security/property tests: 63 passed.
- Flutter analysis: no issues.
- Logs: `otp-readiness-build-2026-11-14.txt`,
  `otp-readiness-lint-2026-11-14.txt`, `otp-readiness-tests-2026-11-14.txt`.

## Still unverified

Real carrier SMS delivery, Play-distributed app-signing certificate, Firebase
billing (read permission denied), and completed device signup/publishing flows.
These checks did not install an APK, send codes, or exercise a real payment.

From the `genie` directory, compile using:

```powershell
.\scripts\build_apk.ps1 -Env production
```

Test phone-only signup, email-only signup, both contacts (SMS only), wrong/resend
codes, then Google OAuth -> Create Property -> phone verification. Verify that
email added during phone-first signup can be verified later in Personal Info.
