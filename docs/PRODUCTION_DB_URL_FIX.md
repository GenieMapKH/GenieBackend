# Production database URL problem and exact fix

**Availability repair completed through the CLI on 6 November 2026, verified at approximately 18:15 Cambodia time.** Property, Chat, Payment, and Notification now use the working production session pooler in Infisical and Railway. All four new deployments reached SUCCESS, and their inspected logs show the services listening without IPv6, Prisma, authentication, or permission errors. The diagnosis below records the earlier state; see the repair verification at the end for the outcome.

Checked 6 November 2026, 18:09-18:10 Cambodia time (UTC+7). This check changed no production settings, credentials, deployments, or records.

## The immediate problem

Four production services still have the wrong **runtime `DATABASE_URL`** in both Infisical and Railway:

| Railway service | Infisical environment / folder | Current `DATABASE_URL` | Evidence |
|---|---|---|---|
| `property` | `prod` / `/property` | Direct IPv6 host, user `postgres` | Current deployment logs contain `ENETUNREACH`; public listing discovery returns HTTP 500. |
| `Chat` | `prod` / `/chat` | Direct IPv6 host, user `postgres` | Current deployment logs contain `ENETUNREACH`. |
| `payment` | `prod` / `/payment` | Direct IPv6 host, user `postgres` | Runtime connection check fails. No recent payment-operation error in the inspected logs; checkout was not exercised. |
| `Notification` | `prod` / `/notification` | Direct IPv6 host, user `postgres` | Current deployment logs contain `ENETUNREACH`. |

The bad destination is `db.ovrwutngmsompqpchlgt.supabase.co:5432`. DNS supplies no IPv4 address; its IPv6 address is `2406:da18:167b:f902:d99e:6979:ce31:e5e7`, matching the deployed services' errors.

Authentication and Users retain their repaired session-pooler URLs. Read-only connection and table-read checks pass for both. Do not replace their working `DATABASE_URL` values.

## Fix these four values

1. Open Infisical, select environment **`prod`**.
2. Copy the entire working **`DATABASE_URL` from `/authentication`**. Its destination and username must be:

   ```text
   postgresql://postgres.ovrwutngmsompqpchlgt:<EXISTING_PRODUCTION_PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

   The password above is a placeholder. Copy the existing secret privately; do not paste it into this document, source control, or chat. Copying the full working URL also preserves password escaping and connection options.

3. Set **`DATABASE_URL`** to that working production value in each of `/property`, `/chat`, `/payment`, and `/notification`. This is an availability repair using the administrator credential these services already use. It does not establish restricted service logins.
4. Let each Infisical sync complete. In Railway **production**, confirm each corresponding service's **`DATABASE_URL`** now has the pooler host and tenant-qualified username above. Check the variable itself, not only `DIRECT_URL` or a `*_DATABASE_URL` variable.
5. Confirm each service has a new successful deployment after the variable update; redeploy it if the sync did not trigger one. Restarting an instance with the old URL does not repair its configuration.
6. Verify database-backed requests after deployment. The property request below should return HTTP 200, including an empty result if no listings exist:

   ```text
   GET https://tilomnovgateway.sparkbytekh.com/v1/public/properties/closest?lat=11.55&lng=104.92
   ```

   Also verify an authenticated chat read, notification-preferences read, and a controlled payment flow. A Railway SUCCESS deployment or `/health` HTTP 200 only proves process liveness; those checks do not query the database. Do not send a live checkout or payment webhook merely as a health probe.

No APK rebuild is required for these backend connection updates. Do not reset the working production administrator password as part of this endpoint repair.

## Why the other database variables did not repair it

The shared runtime Prisma service constructs its PostgreSQL pool from **`process.env.DATABASE_URL`**. It does not fall back to `PROPERTY_DATABASE_URL`, `CHAT_DATABASE_URL`, `PAYMENT_DATABASE_URL`, `NOTIFICATION_DATABASE_URL`, or `DIRECT_URL`.

`docker-compose.yml` explicitly maps the per-service `*_DATABASE_URL` variables into each container's `DATABASE_URL`. Railway does not run that Compose mapping; setting an alternate variable there does not change the URL the app reads.

Current read-only tests of those alternate production URLs:

| Variable | Result |
|---|---|
| `AUTHENTICATION_DATABASE_URL` | Authentication fails: PostgreSQL `28P01`. |
| `USER_DATABASE_URL` | Authentication fails: PostgreSQL `28P01`. |
| `PROPERTY_DATABASE_URL` | Authentication fails: PostgreSQL `28P01`. |
| `CHAT_DATABASE_URL` | Connects; SELECT permission checks pass on the inspected chat/account tables. Writes and complete chat flows were not tested. |
| `PAYMENT_DATABASE_URL` | Connects; SELECT permission check passes on `payment.payment_transactions`. Writes and complete payment flows were not tested. |
| `NOTIFICATION_DATABASE_URL` | Authentication fails: PostgreSQL `28P01`. |

`28P01` means the supplied login/password combination was rejected. Do not copy these alternate values indiscriminately into `DATABASE_URL`. Provision and validate restricted service credentials separately after availability is restored; see [database service logins](DATABASE_SCHEMAS.md) and [rotation setup](SECRET_ROTATION.md).

Chat's `DIRECT_URL` still identifies staging (`postgres.nzurymawikvamjjfbdmz`); correct it to production or remove it if unused. Payment's `DIRECT_URL` now identifies production, but its runtime `DATABASE_URL` still points at the bad IPv6 host. Editing `DIRECT_URL` alone therefore does not fix Payment's runtime connection.

## Service-to-service HTTP URLs

The gateway's configured targets match the destination services' advertised Railway private domains and ports:

| Variable | Current target |
|---|---|
| `AUTH_SERVICE_URL` | `http://authentication.railway.internal:8080` |
| `USER_SERVICE_URL` | `http://users.railway.internal:4002` |
| `PROPERTY_SERVICE_URL` | `http://geniebackend.railway.internal:4003` |
| `CHAT_SERVICE_URL` | `http://chat.railway.internal:4004` |
| `PAYMENT_SERVICE_URL` | `http://payment.railway.internal:4005` |
| `NOTIFICATION_SERVICE_URL` | `http://geniebackend-1e79da11.railway.internal:4006` |

No host/port mismatch was found. Private-network requests from the containers were not run because Railway has no registered SSH key. Matching configuration does not prove every internal request succeeds.

## Other remaining production issue

Production Users, Property, and Chat still carry staging Supabase Storage settings. Repairing database availability does not isolate avatars, listing photos, or chat attachments. Plan Storage credential/object migration separately; changing Storage's destination does not move existing files.

## Verification limits

Inspected current Railway variables, the newest deployment and up to 250 log entries per service, and the six Infisical database values. All six Infisical `DATABASE_URL` values match Railway. Database tests were local read-only transactions with zero-row SELECT permission checks, not write tests or private-container probes. Production gateway health and JWKS return HTTP 200; listing discovery returns HTTP 500, while staging's equivalent request returns HTTP 200. No real-user credentials or data are included here.

## Repair verification, approximately 18:15 Cambodia time

Updated only Infisical `prod` `DATABASE_URL` in `/property`, `/chat`, `/payment`, and `/notification` to the validated working production pooler URL. Read back each saved secret and confirmed Railway received the pooler host and tenant-qualified production username. The production database password was preserved for all four services; no password was reset and no account records were edited.

| Service | New deployment | Result | Read-only Prisma check using its synced runtime URL |
|---|---|---|---|
| Property | `bfb80151-0b90-4c71-bf4a-e67b8ac6214f` | SUCCESS; listening; no inspected error patterns | `property.findFirst` passed. |
| Chat | `2e8df06e-2574-46f3-ba22-44d17f77f693` | SUCCESS; listening; no inspected error patterns | `message.findFirst` passed. |
| Payment | `0f5ec7aa-04f9-4276-a998-62dca6b0d35b` | SUCCESS; listening; no inspected error patterns | `paymentTransaction.findFirst` passed. |
| Notification | `38f01e3e-e64f-48a4-82ed-1582e11b681b` | SUCCESS; listening; no inspected error patterns | `pushDevice.findFirst` passed. |

The read checks requested only an ID, did not print customer data, and did not create or modify business records. They verify database access from the local diagnostic process using each service's synced connection URL, not the entire authenticated path inside its container.

Production `GET /health`, `GET /v1/auth/.well-known/jwks.json`, and `GET /v1/public/properties/closest?lat=11.55&lng=104.92` all now return HTTP **200**. All three equivalent staging checks also return HTTP **200**. The production listing request previously returned 500.

No APK rebuild is needed for this repair. Full authenticated chat, real checkout/webhook processing, and push delivery were not exercised. Staging Storage settings, unused invalid `*_DATABASE_URL` credentials, Chat's staging `DIRECT_URL`, and migration to restricted runtime database logins remain separate outstanding work; this repair did not change them.
