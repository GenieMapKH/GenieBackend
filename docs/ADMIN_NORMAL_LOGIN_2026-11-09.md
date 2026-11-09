# Normal owner login — 9 November 2026

> Historical password-only implementation, superseded by the required email-link second step. See [current admin login](ADMIN_DASHBOARD.md). The production deployment results below describe the earlier password-only behavior.


At the user's request, removed the separate admin sign-in and email-link flow. The existing owner account now uses the ordinary email/password login endpoint and screen, then opens the dashboard according to its server-issued role. The existing password hash and account content were preserved. Production contains exactly one admin account, matching the requested owner.

Deleted the dedicated Flutter admin login page/repository, backend challenge endpoints/service/DTO, extra token claims, Gateway app-link routes, Android link intent, iPhone domain entitlement, and unused authentication settings. Admin APIs still require both a signed admin role and a currently active admin account. Public registration cannot choose an admin role; Google cannot replace the owner's password login.

## Verification

- Backend: 83 authentication tests, 6 admin-guard tests, and 17 Gateway tests passed. The isolated deployment snapshot built every service successfully.
- Flutter: 21 authentication/session tests and the normal-login routing widget test passed. Focused static analysis was clean.
- Production: wrong password returned 401; the supplied owner credentials returned a normal admin session. Dashboard access and refresh succeeded. Anonymous access was denied. The obsolete email endpoints and landing route returned 404. The verification session was logged out and its token was refused afterward.
- Rebuilt the signed production Android APK and exported it to the configured desktop APK directory. The APK manifest no longer contains an admin app-link entry. A concurrent Flutter check initially caused a generated-plugin build conflict; rebuilding after checks finished succeeded.

| Service | Successful production deployment |
|---|---|
| Authentication | `7e0f2200-2306-4f04-9db7-ddc53a286af4` |
| Users | `d86b2b1e-97a2-4679-83b8-a2d8f865f545` |
| Gateway | `eec1671a-a0b6-42a3-a2a1-b293a457f80d` |
| Notification | `74167eda-907c-4973-8471-07e098fee387` |

Staging was not provisioned or deployed. Physical-phone login and an iPhone build were not exercised. These CLI deployments use an isolated copy of the previous production source with the requested changes; retain the corresponding working-tree changes in the next normal Git-based release.
