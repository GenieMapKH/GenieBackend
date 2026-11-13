# Launch pricing and listing contacts

Prices follow the approved Cambodia launch rules. USD, using the existing tax-inclusive checkout convention.

| Plan | Monthly | Annual (12 months, paid upfront) | Active listings |
| --- | ---: | ---: | ---: |
| Free | $0 | — | 1 |
| Silver | $7 | $70 | 10 |
| Gold | $15 | $150 | 30 |
| Diamond | $29 | $290 | 100 |

An additional listing costs $2 for exactly 30 days from verified payment. All renewals are manual. Subscriptions include their listing capacity; the backend rejects a separate listing charge when the plan already covers the listing. Only Active listings consume capacity. Sold, Draft, unavailable, and separately paid listings do not consume included capacity. An expired individually paid listing may use an available Free slot.

Existing purchased periods keep their original capacity and price credit until expiry. New purchases and renewals use the launch catalog. Upgrades keep the original end timestamp and prorate the price difference, using the original purchased price as credit. A billing-cycle switch is offered after expiry; upgrades preserve the current cycle.

Featured-promotion duration/placement, agency verification, team tools, and launch discounts remain product decisions. These are not advertised as delivered paid benefits. Verification is never sold. Checkout promises capacity and tools, not leads or sales.

## Database rollout

Apply **46_subscription_billing_period**, then **47_listing_contact_phones**, before starting the updated backend. These additive migrations preserve existing rows and are safe to rerun. Migration 46 snapshots old paid-period terms; migration 47 adds an empty array of extra listing contacts. A rollback to the previous application can leave these columns in place.

Use the existing migration runner with the intended environment's administrator connection:

```sh
node scripts/apply-migrations.js 46_subscription_billing_period 47_listing_contact_phones
# Production uses only the separate production administrator configuration:
node scripts/apply-migrations.js 46_subscription_billing_period 47_listing_contact_phones --prod
```

## API changes

- `GET /payments/subscriptions/quote/:tier?billingPeriod=monthly|annual` returns a signed, five-minute price quote. Monthly is the default. Checkout still accepts `{tier, method, requestId, quote}`; the signed quote determines its price, period, and capacity. Bank verification and idempotency remain required.
- `GET /properties/my/publishing-usage` now returns `{used, listingLimit}`. Clients use the server's limit so legacy paid capacity displays correctly.
- `POST /auth/register` requires a normalized phone and password; email is optional and still requires email ownership proof if supplied. No SMS proof is accepted or required. New phone contacts are unverified.
- `POST /auth/reset-password/phone` is removed. Password recovery uses a verified email. Phone-only accounts should add an email before they need recovery; Google accounts can sign in with Google.
- `PATCH /users/me` can add a first phone to an authenticated account that has none. The database update also requires the stored phone to be null, preventing a concurrent request from overwriting an existing number.
- `POST /auth/account/phone` takes `{phone, password}` or `{phone, idToken}`. Existing identity checks, established-device protection, uniqueness, and session revocation remain in force when changing an existing number. Saving a number does not assert ownership of it.
- Property create/update accepts `contactPhone` and `additionalContactPhones` (up to four extras). All supplied numbers are validated and normalized. Drafts may be incomplete; publishing, paid checkout, payment fulfillment, and edits to live listings require an account contact and a valid listing contact. The account number supplies a missing listing contact.
- Additional listing phones have the same privacy and rate-limit protection as primary phones. Guests receive none of them; map/search summaries exclude contact details.

## Flutter behavior

Signup requires the phone and labels email optional, with a recovery explanation. Posting prefills the account phone, saves a first contact for OAuth accounts, and offers a plus button for extras. Buyers can choose among the published numbers before dialing.

Liquid Glass is the default on every device; Minimalistic is the saved alternative. System reduced-transparency and high-contrast preferences retain solid surfaces.

Place searches draw the real mapped border with a light fill when a Cambodian administrative area can be matched by name, type and location to the bundled OCHA/WFP COD-AB snapshot (valid 2018-10-04). Disconnected polygons and holes are retained; the camera and listing results use that shape. The source-info button gives attribution and the snapshot date. Nearby listings remain clear, without the old rectangular blur/dim mask. Unmatched places and newer subdivisions keep nearby results and camera framing without a fabricated outline. This is published boundary data, not guaranteed current legal geography. Drawing hides the area border, and clearing the search removes it. The drawing pin is 34 logical pixels wide and rasterized at 3x resolution with its original aspect ratio and anchor.

## Verification

The change was checked with the complete Flutter and backend suites, focused map/pin/contact/annual-checkout regressions, backend builds and lint, and an isolated PostgreSQL 17 database. All migrations were applied locally, and migrations 46–47 were rerun twice in a rolled-back local transaction. The subscription database suite covers annual persistence, concurrent free publishing, purchase retries, cancellation, expiry, and transaction rollback. Mock payments are used; live ABA charges and physical iOS/Android rendering require device validation.
