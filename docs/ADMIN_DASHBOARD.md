# Admin sign-in and dashboard

Admin sign-in uses the existing Authentication service and the existing Flutter app. It requires the configured account password followed by a single-use email link. The email token expires after ten minutes; Redis stores its hash, and only the app's POST exchanges it for a session.

Production Authentication settings:

```text
ADMIN_LOGIN_EMAIL=<the designated account email>
ADMIN_APP_LINK_URL=https://tilomnovgateway.sparkbytekh.com/admin-login
```

The designated existing account must have `role = 'admin'` and a bcrypt password hash with `has_password = true`. Account setup revokes previous sessions. Passwords belong in the account's hash, never in configuration or source. Password and Google login cannot issue admin sessions. Access and refresh tokens carry the email-verification claim; role promotion does not upgrade an older ordinary session.

The Gateway serves Android verification metadata at `/.well-known/assetlinks.json`, matching the signed production APK. The `/admin-login` landing route does not consume the token and provides an Android app-opening button if the mail client opens a browser first. Both it and authentication responses use `Cache-Control: no-store`.

The iPhone entitlement is prepared in `ios/Runner/Runner.entitlements`. When the Apple signing team exists, set `APPLE_TEAM_ID` on Gateway to its ten-character Team ID and build/sign the iPhone app with that team. Until then the Apple association endpoint deliberately publishes no app IDs.

## Dashboard API

`GET /v1/admin/dashboard` requires a verified admin access token and a live admin role. User assembles its own account/report counts and signed internal requests to Property and Payment. User needs `PROPERTY_SERVICE_URL`, `PAYMENT_SERVICE_URL`, and the same `INTERNAL_SERVICE_SECRET` as those services.

The overview reports enabled regular-user accounts, account growth, active/all listings, listing leads, open reports, active subscriptions by tier, pending payments, and successful payment volume over the last seven days. The app identifies mock-payment volume as simulated. Account enablement is not a measure of daily active usage; crash, retention, and latency measurements are not collected by this endpoint.
