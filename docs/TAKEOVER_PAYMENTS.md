# Takeover Payments listings

`Takeover Payments` is a listing setting alongside `Sale`, `Rent` and `To Let`.
It retains the physical property type. It is included in the app's For sale
filter and can also be selected independently. Map markers and listing badges
use purple (`#7C3AED`; visited markers `#C4B5FD`) with a text label.

## Price and buyer presentation

The server sets `price` to `takeover.sellerAmount + takeover.remainingBalance`,
rounded in cents. This combined price is used by existing price filters, sorting,
map labels and price-change notifications. The seller cannot advertise the
upfront amount as the entire acquisition price. Ordinary listing discounts are
not applied to takeover obligations; adjust the seller amount instead.

The remaining balance means the unpaid contract balance or loan principal,
excluding future financing interest. Additional scheduled payments are already
included in that balance and are not added again. Fees and overdue amounts are
shown separately; the combined price is not represented as a lifetime total.
The buyer breakdown preserves cents and the full entered interest rate.

The form and buyer view support English and Khmer. The detail view shows the
provider, balance date, payment schedule, rate, permission status, costs and
additional payments. Cards and shared messages identify the listing setting
and distinguish the seller amount from regular instalments.

## API contract

`POST /properties` and `PATCH /properties/:id` accept `listingType: "Takeover Payments"`
and a nested `takeover` object. Existing ownership/authentication checks apply.
Supplying a takeover object on update replaces its terms and schedule. Omitting
the object preserves it; `null` removes it from a draft. Switching to another
listing setting deletes the takeover terms and schedule in the same database
write. Terms sent for other listing settings are not stored.

| Field | Publication requirement |
| --- | --- |
| `providerType` | `Developer` or `Bank` |
| `providerName` | Nonempty name, max 200 characters |
| `projectName` | Required for Developer, max 200 characters |
| `sellerAmount` | Nonnegative USD amount; zero is allowed |
| `remainingBalance` | Positive USD amount |
| `balanceAsOf` | Valid `YYYY-MM-DD` date |
| `paymentAmount` | Positive regular instalment, including its current scheduled interest if any |
| `paymentFrequency` | `Monthly`, `Quarterly` or `Yearly` |
| `remainingMonths` | Integer from 1 through 1200; not inferred from instalment amount |
| `nextPaymentDate` | Valid `YYYY-MM-DD` date |
| `interestType` | `None`, `Fixed`, `Variable` or `Unknown` |
| `annualInterestRate` | Required for Fixed/Variable, 0 through 100 percent; max two decimals |
| `transferStatus` | `Not checked`, `Conditional` or `Written approval`; `Not allowed` blocks publication |
| `transferFee` | Optional nonnegative amount; null explicitly displays as unknown |
| `transferFeePayer` | `Buyer`, `Seller`, `Shared` or `Unknown` |
| `arrearsAmount` | Nonnegative amount; enter zero when none |
| `arrearsPayer` | Required when overdue amount is positive; same payer options |
| `notes` | Max 1000 characters; required when overdue amounts exist to explain whether they are included in the balance |
| `hasAdditionalPayments` | Explicit boolean confirmation |
| `additionalPayments` | Array, at most 24 rows; each row needs positive `amount` and a valid `dueDate` when published |

All money fields accept at most two decimals and fit `DECIMAL(12,2)`; the combined
price must fit too. Additional scheduled amounts cannot exceed the remaining
balance. A positive additional-payment confirmation requires at least one row;
a negative confirmation requires an empty array.

Drafts may remain incomplete, including unfinished schedule rows. Completeness
is enforced for immediate active creation, live/pending edits, direct publish,
relist, and the start and settlement of a paid publication. Existing terms cannot be removed
from a live takeover listing without changing its listing setting.

These are seller-reported terms, including permission. Publishing does not
assign a purchase agreement, transfer a bank loan, verify approval, or collect
property payments. The buyer view explicitly asks buyers to confirm the terms
and transfer process with the provider. Unknown terms are displayed as unknown.

## Storage and rollout

Migration `40_property_takeover_payments` adds
`listing.property_takeovers` (one row per listing) and
`listing.property_takeover_payments` (ordered additional payments). Both use
foreign keys with cascading deletion, row-level security and property-service
grants. Existing listings need no backfill.

Apply migration 40 to each intended environment **before** deploying a backend
that includes the takeover relations in its read queries. Then generate the
Prisma client, deploy the backend, and release the app. Existing app versions
can still read the ordinary `price`; they will not display the new breakdown.
No production migration or deployment is performed by the implementation.

## Verification

- Property service unit tests cover nested input validation, canonical pricing,
  schedule replacement, draft handling and publication guards.
- Flutter tests cover filling and publishing the form, editing terms,
  conditional schedules, price filtering, marker colors and buyer layouts in
  English and Khmer.
- `TAKEOVER_TEST_DATABASE_URL` enables `takeover.integration.spec.ts` against a
  disposable **local** PostgreSQL database with migration 40 applied. It checks
  stored terms, map/feed reads, replacement/deletion/cascades, private drafts
  and table security. Test records are removed afterward.
- Migration 40 was applied twice successfully against isolated PostgreSQL 17.

The final property-service run passed 402 tests, including the three local
database checks (14 unrelated opt-in tests were skipped). The broader Flutter
run passed 237 tests; two existing assertions in `property_share_test.dart`
still expect old wording for private and pending listings. The takeover form,
buyer breakdown, card-layout, filter and marker tests passed. No physical-device
camera/gallery check or production deployment was performed.
