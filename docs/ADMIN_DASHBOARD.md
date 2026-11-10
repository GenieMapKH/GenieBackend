# Admin dashboard

The owner enters credentials on the normal login screen (`POST /v1/auth/login`). The backend verifies the password and sends a sign-in link to the verified admin email. It returns `{"status":"admin_email_required"}` without access or refresh tokens. Flutter shows a waiting screen instructing the owner to open Gmail and tap **Open Tilomnov**.

The HTTPS link opens `/admin-login?token=...` in the installed app. The app exchanges the token through `POST /v1/auth/admin-login/complete` and only then saves the session and opens `/home`, with the admin workspace tabs. No separate admin credential form is needed. Links expire after 10 minutes and are consumed atomically once. Changing the password/email, demoting or deactivating the account invalidates outstanding links. Email requests are limited to one per minute per admin account, in addition to normal password-attempt protection. Redis or mail failures never grant a session.

Admin APIs verify the RS256 access token directly in the user service, require the signed `adminMfa: true` claim, the signed admin role, a session ID, and a currently active admin account. Forged identity headers are insufficient. The guard checks Redis session revocation and fails closed with HTTP 503 if that check is unavailable; signed-out sessions receive HTTP 401. Verified identity headers are replaced with the signed subject before report-review handlers run. Refresh preserves the email proof and rejects older password-only admin refresh tokens. The Gateway rejects password-only admin access tokens; the updated app discards those sessions and requires a fresh login. Public registration cannot grant admin access, and Google sign-in cannot bypass the admin password/email flow.

Android uses verified HTTPS App Links on `tilomnovgateway.sparkbytekh.com/admin-login`, with association metadata served by the Gateway. Gmail tracking may first open a browser; that page offers an **Open Tilomnov on Android** button without consuming the token. The production APK signing certificate must match the association file. iOS associated domains are included, but Gateway needs `APPLE_TEAM_ID` and a correctly signed iPhone build before Universal Links work. Existing email delivery provider settings are reused; no new password or admin-email environment setting is needed.

Deploy Authentication and Gateway together with shared admin-guard changes in services that use it, then install the updated app. Older app builds cannot complete this login contract. Verify a real Gmail-to-app round trip on a phone after deployment. Local automated checks do not establish live email delivery or OS link association.

GET /v1/admin/dashboard assembles account/report counts and signed internal requests to Property and Payment. User needs PROPERTY_SERVICE_URL, PAYMENT_SERVICE_URL, and the same INTERNAL_SERVICE_SECRET as those services.

The overview reports enabled regular-user accounts, account growth, active/all listings, listing leads, open reports, active subscriptions by tier, pending payments, and successful payment volume over the last seven days. The dashboard presents the recorded seven-day USD payment total as income, without developer-facing mock or simulation notices; payment-provider metadata remains available in payment records. Silver, Gold and Diamond tier cards show current subscription counts, including zero-count tiers, and open filtered subscription lists. Account enablement is not daily active usage; this endpoint does not measure crashes, retention, or API latency.

Every metric opens a scrollable detail list through `GET /v1/admin/dashboard/records?section=...&offset=0`. Sections are `active-users`, `all-users`, `new-users`, `active-listings`, `all-listings`, `new-listings`, `reports`, `leads`, `subscriptions`, `successful-payments`, and `pending-payments`. Pages contain at most 50 items and a nullable `nextOffset`. Subscriptions also accept `tier=silver|gold|diamond`. Every section accepts optional `q` (trimmed, maximum 100 characters). Search runs on the server before pagination: accounts match names, usernames, email and phone; reports match reason/details and reporter/reported account fields; listings match title/description/contact phone; leads match listing title; subscriptions match tier; payments match purpose and subscription tier. Full UUIDs match the relevant record, user, listing or transaction IDs exactly. Text matches are case-insensitive. The app debounces search by 350 ms, resets to the first page when the query changes, and preserves the query and tier when loading more. Clearing search restores the section list. New-account, new-listing, lead and successful-payment lists use the same rolling seven-day filters as the overview; reports show the open queue. Lists can shift when records change; pull to refresh to reload from the start.

The account service enriches listing/payment pages with account information in one bounded lookup. Only explicitly selected profile/contact fields are returned. Password hashes, provider secrets, session tokens, chat keys and backups are excluded. Listing/payment tables remain in their owning services, reached through signed `/internal/admin/dashboard/records` requests.

`GET /v1/admin/dashboard/health` checks the gateway, authentication, users, listings, chat, payments and notification `/health` endpoints in parallel, each with a three-second timeout. It returns each service's `up`, `down` or `not_configured` state, response time, available HTTP status and `checkedAt`. These are HTTP process checks; they do not assert database, Redis or external provider readiness. One failed service does not remove the other results, and Flutter loads this panel independently of dashboard metrics.

On the user service, set `GATEWAY_SERVICE_URL`, `AUTH_SERVICE_URL`, `PROPERTY_SERVICE_URL`, `CHAT_SERVICE_URL`, `PAYMENT_SERVICE_URL` and `NOTIFICATION_SERVICE_URL` to internal base URLs. `USER_SERVICE_URL` is optional: its probe otherwise uses its own listening port on localhost. Missing remote URLs in production display as not configured; development uses the standard localhost ports. Docker Compose supplies all seven addresses. Deploy the user, property and payment service changes together with the Flutter update; no migration is needed.

On 9 November 2026, the missing gateway and notification probe addresses were configured on Railway's Users service in production and Staging using `GATEWAY_SERVICE_URL=http://${{Gateway.RAILWAY_PRIVATE_DOMAIN}}:${{Gateway.PORT}}` and `NOTIFICATION_SERVICE_URL=http://${{Notification.RAILWAY_PRIVATE_DOMAIN}}:${{Notification.PORT}}`. Both Users deployments completed successfully. Keep these service references when recreating either environment. `not_configured` means no probe address was supplied; `down` means a configured probe failed.

Income is split by the server's payment purpose: `SUBSCRIPTION` for monthly Silver/Gold/Diamond purchases and `LISTING_PUBLISH` for the $1 one-time property-post fee. The payment overview adds `income: { timeZone, subscriptionUsd, listingUsd, days: [{ date, subscriptionUsd, listingUsd }] }`. A single bounded aggregation includes only successful USD transactions for those purposes with `paidAt` between now minus seven days and now. Daily bars use Cambodia calendar dates (UTC+7), including empty dates; the first and last dates are partial because the seven-day window rolls. Counts and amounts come from transactions, not subscription-count multipliers. Pending, failed and refund-required transactions do not contribute.

The two income-source cards open successful payment records with optional `purpose=SUBSCRIPTION|LISTING_PUBLISH`. The user service validates and forwards that filter; payment validates it again and applies it before pagination. Search, refresh and load-more preserve the purpose. Subscription transaction icons use the purchased tier's existing Silver/Gold/Diamond styling; one-time listing payments use a separate post icon and label.

Deploy the shared-library guard changes with Users and the income aggregation with Payment, then update Flutter. Older Payment responses leave the chart unavailable rather than inventing a zero-valued breakdown. No migration or new dependency is required.

The property-photo report groups, admin property editor/moderation and app-wide photo advertisements are documented in [Admin moderation and ads](ADMIN_MODERATION_AND_ADS.md).

## Financial retention and publishing usage

Apply `node scripts/apply-migrations.js 44_preserve_financial_history` to the
intended database before deploying the updated Payment and Users services.
The migration retains transactions when an account or property is deleted,
clearing the deleted user/property references. Amounts, purposes, purchased
tiers, provider references, statuses and payment dates remain. Account details
on retained payment records are null; income still uses the same rolling
seven-day window. Banning already retains these records. Deleted accounts'
current subscription rows are removed, since they no longer grant access;
their subscription purchases remain in the ledger. Previously deleted
transactions require recovery from a backup.

Separately paid listings no longer consume a plan slot. The Free plan keeps
one listing alongside individual posts within their paid month. After the month,
those posts require another payment or available active-subscription capacity;
without coverage, they move to Draft. Deploy Property before updating Flutter:
`GET /v1/properties/my/publishing-usage` returns `{ "used": 1 }` for the
authenticated user's Active/Pending listings excluding separately paid posts.
The subscription screen and add-property flow use this count. Owner listing
tab counts continue to count every listing in each status.

Migration `45_monthly_listing_access` adds monthly individual-post access and
three-day expiry reminders for posts and subscriptions. Apply it before starting
the updated Payment/Property services; see [publishing and renewal rules](PAYMENT_GATEWAY_HANDOFF.md).
Admin property lists and report cards reuse the user app's Saved/Nearby card,
responsive widths, and the same hero transition into property details. Drafts
and removed listings remain openable for moderation.


## Admin workspace navigation

The Flutter admin workspace has six tabs: Explore, Services, Account, Activity,
Financial, and Profile. Feed is available only in the normal user workspace.
Explore uses the same map, search, filters, nearby listings, carousel, and listing
detail sheets as the normal workspace. Admin detail sheets add protected edit,
remove-post, and owner moderation actions. Switching admin tabs keeps the map
alive. Completed moderation refreshes map and nearby results and clears the
selected listing card.

Services shows each configured backend probe as a responsive status card; Account
keeps the account metrics and existing account detail/moderation lists; Activity
keeps listing, lead, report, and advertising actions; Financial keeps income,
payment records, and membership breakdowns. Each tab retains its own loading,
error, retry, and refresh behavior using the existing admin endpoints.

Profile reuses personal-information/avatar editing and Security (password and
signed-in devices), plus appearance, language, and sign-out. Admins do not see
customer subscriptions, cookie settings, saved searches, notification preferences,
blocked accounts, or self-removal in this menu. Normal user menus are unchanged.

A navy/gold administrator avatar frame and identity badge are based on the saved
server role. The Users public profile now includes `role`; Chat conversations add
`participantIsAdmin`; the Property public profile adds `isAdmin`. These additive
fields expose no credentials. Flutter shows the frame in admin Profile, conversation
lists/headers, participant summaries, and loaded public profiles. Older responses
without these fields show an ordinary identity. Deploy Users, Chat, and Property
with Flutter to enable the public identity; no migration is needed.
