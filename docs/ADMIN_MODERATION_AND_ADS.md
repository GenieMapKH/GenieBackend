# Property moderation and photo advertisements

The admin Explore tab is a searchable property-card browser, including drafts and removed posts. All listing details load through protected admin APIs. The existing property form edits titles, prices, property-specific fields, photos and boundaries using admin routes; ordinary owner routes keep their ownership checks. Every admin API uses the signed-token, email-verification, session-revocation and current-admin-account guard.

## Reports

The Open reports metric opens one photo card per reported property, with its open report count. Account reports remain available as avatar cards. Opening a target shows the reporters, reasons, notes and the total number of reports/people, with pagination and individual resolution. The existing database constraint permits one open report per person per target, so the open-report count is also the distinct open-reporter count. Search matches reporter names/handles, reasons and details; badges retain the target's complete open count.

- `GET /v1/admin/moderation/reports?offset=0&q=...`: groups, at most 20 per page.
- `GET /v1/admin/moderation/reports/property/:id?offset=0`: reporter details, at most 50 per page. Use `user` instead of `property` for account reports.
- `PATCH /v1/reports/admin/:id` with `{"status":"resolved"}` closes an individual report.

## Moderation actions

- `GET /v1/admin/properties/:id` reads all listing details without public visibility restrictions. Credentials and private identity/backup keys are never selected.
- `PATCH /v1/admin/properties/:id` reuses the property update DTO and lifecycle validation. The server determines the existing owner; clients cannot change ownership or payment status.
- Photo upload/confirmation/removal and boundary editing use the corresponding `/admin/properties/:id/images/...` and `/boundary` routes. The existing file ownership, type, size and photo-count checks still apply.
- `POST /v1/admin/properties/:id/remove` with `{"reason":"..."}` marks the listing Deleted, invalidates public/search views and prevents owner republication. It preserves reports, photos and financial rows. A pending payment cannot republish a removed listing; the existing settlement conflict handling still applies.
- `POST /v1/admin/users/:id/ban` with a reason sets a permanent account ban and deactivation, revokes sessions and invalidates public content. Password and social sign-in cannot reactivate it; refresh is refused. The migration serializes session creation against bans in PostgreSQL so concurrent issuance cannot escape revocation. Existing access-token revocation retains the platform's Redis-outage limit: regular access tokens can last until expiry if Redis is unavailable.
- `DELETE /v1/admin/users/:id` with a reason reuses account erasure: files, sessions, Firebase identity, reset codes, listings, chats and the user row are removed. Payment transactions remain with null user/property links after migration `44_preserve_financial_history`; subscription and one-time revenue remain in the Financial dashboard. The UI requires a reason and typing DELETE. This action is irreversible; use a ban to retain the account and its content.

Admin accounts and self-moderation are refused. The user service records actor, target, action, reason and requested/completed/failed status in `account.moderation_actions` before forwarding mutations. Audit rows deliberately have no user foreign key, so account deletion cannot erase its audit history. Authentication and property mutations are signed internal calls, never publicly proxied `/internal` routes.

## Photo advertisements

Manage ads is available from the admin dashboard. Multiple photos may be selected together. A successful confirmation makes the image active; removing a photo stops it being returned to user apps. Partial batch failures keep already uploaded ads.

- `GET /v1/public/ads` returns `{id,imageUrl,width,height}` entries, or an empty array. Dimensions describe the published, rotation-corrected image. No sign-in is needed to see configured ads.
- `GET /v1/admin/ads` lists the configured ads.
- `POST /v1/admin/ads/uploads` returns a private staged-upload path and signed storage URL.
- `POST /v1/admin/ads` with `{"path":"<admin-id>/<upload-id>"}` confirms that admin's upload. The server verifies the path and file, enforces a 5 MB upload / 40 MP decode limit and re-encodes to JPEG within 1600x1600 pixels, preserving proportions without upscaling. Arbitrary external URLs, executable content and copied upload paths are refused. Confirmation retries are idempotent. At most 100 ads may be active.
- `DELETE /v1/admin/ads/:id` removes the entry and attempts to remove its public file. Storage cleanup failures are logged; they do not leave the ad active.

Landscape photos use full-width 16:7 banners between grid sections. Portrait photos occupy a listing-grid cell with the same dimensions as neighboring cards. Feed, empty states and the admin preview use a half-width 2:3 card for portrait photos. All frames contain the entire image without stretching or cropping ad text. Short and empty listing lists still show one configured ad; longer feeds insert ads after every four posts. The active collection is shuffled and cycled, giving a stable order between refreshes. All placements use the same component and refresh their shared ad list every minute. No configured ads, initial loading or failed ad requests produce no ad slots or artificial gaps. Ads are image-only; no click destinations or tracking were added. Advertisement labels are localized in English and Khmer.

## Deployment and verification

1. Apply migrations `41_admin_moderation`, `42_advertisements` and `43_advertisement_dimensions` before deploying code that reads the new fields/tables. Regenerate Prisma. For an existing ads table, populate missing dimensions from each stored image's metadata before updating Flutter; old responses without dimensions use the landscape fallback.
2. Deploy Authentication, Users and Property with the updated shared library, then update Flutter. Existing private service addresses and `INTERNAL_SERVICE_SECRET` are reused; no new secret is required.
3. Property prepares private `advertisement-uploads` and public `advertisements` storage buckets using the existing Supabase configuration. Unconfirmed uploads should be expired by a storage lifecycle cleanup policy if upload volume grows.
4. Verify an admin photo upload and removal on staging and a real device; confirm all three placements and session revocation.

Automated checks cover grouped reports/counts, audit-before-mutation behavior, protected routes, image decoding/path validation, EXIF rotation, stored dimensions, mixed portrait/banner grids, preserved listing order, short/empty lists, no-ads layouts, periodic refresh and deletion confirmation.

The 9 November 2026 orientation update was verified with landscape and portrait uploads to staging storage, confirmation, public API responses and cleanup. Migration 43 was applied to staging and production; the three existing production photos had their dimensions filled from stored JPEG metadata without rewriting the images. The Flutter placement update requires an updated app build; physical-device verification remains outstanding.
