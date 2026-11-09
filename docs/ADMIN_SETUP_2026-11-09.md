# Production admin setup — 9 November 2026

Configured the requested existing account with the supplied password stored only as a bcrypt hash, `has_password = true`, and `role = 'admin'`. Preserved the account's profile, Google identity, email verification, and content. Revoked its one existing refresh token; older ordinary access tokens cannot acquire admin permissions because the Gateway and admin guard require the signed email-verification claim.

Saved `ADMIN_LOGIN_EMAIL` and `ADMIN_APP_LINK_URL` in Infisical `prod` `/authentication`; confirmed Railway received them. Saved User's `PAYMENT_SERVICE_URL` in `/user`. The existing Brevo sender is verified and active.

## Deployed source

Created an isolated source snapshot from the previously deployed production commit `62ac79a9a4a83be57cc54dd9a7ee0c900ae26e54`, adding the admin feature files and the credential guard. Unrelated working-directory changes were excluded. All snapshot services built successfully before deployment. These are CLI deployments; the corresponding feature source remains in the local working tree and must be retained in the next normal Git-based release.

| Service | Successful deployment |
|---|---|
| Authentication | `ff5fe9aa-5926-4896-8c7d-6bc66646812d` |
| Users | `36527e5f-0c9c-42a6-8878-834a3e8cda6f` |
| Property | `8d91c7ee-91dd-4a69-a0db-8c610d8d4951` |
| Payment | `ce1efe46-a41e-4c88-8fdb-5f7986463dd6` |
| Gateway | `7dc1c975-0402-4929-8be9-8e1986922ca4` |
| Notification | `04f2821c-bb61-494c-89ba-55d845cd8d5c` |

## Verification

- Authentication tests: 86 passed; admin-guard tests: 7 passed; Gateway tests: 19 passed; Flutter session and warm-link tests: 15 passed. Focused Flutter analysis was clean.
- Built the signed ARM64 production APK and verified its actual SHA-256 signing-certificate fingerprint matches Gateway's public Android association file. Confirmed the APK contains the correct verified HTTPS host and login path.
- Production health and association files returned 200; the admin landing page uses `no-store`; anonymous dashboard access returned 401.
- The supplied password sent a sign-in email through the deployed start endpoint. Brevo recorded successful delivery to Gmail. Retrieved that outgoing verification message through the mail provider and followed its tracking redirect in memory without logging the token.
- Exchanged the actual emailed token for an admin session; replay returned 401. Refreshed it and confirmed admin verification remained present. Loaded real dashboard metrics successfully, logged out, and confirmed the same access token was then refused. No verification session was left signed in.
- The sender wraps links for click tracking. If Gmail opens the browser first, the landing page's **Open Tilomnov on Android** button opens the installed production package.
- Sent a fresh unused sign-in link after closing the verification session. Brevo recorded delivery to Gmail at 16:52:25 Cambodia time; that link was not exchanged by the setup checks.

The Android APK is `genie/build/app/outputs/flutter-apk/tilomnov-production.apk`, also exported to the user's configured desktop APK directory. No Android device was connected, so physical Gmail-to-app behavior was not exercised. iPhone entitlements are prepared; Apple Team ID and iPhone signing remain deferred at the user's request.
