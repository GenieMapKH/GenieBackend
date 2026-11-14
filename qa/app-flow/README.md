# Local whole-app HTTP flows

```powershell
npm ci
npm ci --prefix qa/parity
npm run build
docker compose -f qa/messaging/docker-compose.yml up -d --wait
npm run test:app:flows
```

Runs the existing 73 gateway use-case scenarios plus one complete Free/Silver and
account-lifecycle journey against seven real Nest application modules on loopback.
It uses a fresh database with all migrations and the actual restricted service roles.
Ports 41401–41408 and 16389 must be free; PostgreSQL is the existing localhost test
fixture on 55439. A leftover `app_flow_20261114_test` database causes a refusal rather
than silently overwriting it.

The extra journey registers and signs in, posts the first Free listing, refuses a
second unpaid public post, purchases a one-time publication, buys Silver, fills its
ten included slots without another checkout, rejects overflow, archives/republishes,
cancels renewal while retaining benefits, logs out, changes password, deactivates,
signs back in, deletes the account and verifies its financial records survive.
The one-day device rule is advanced only in this disposable database.

Real HTTP calls cross the gateway and service boundaries, including signed internal
calls, JWKS/session verification, multipart-free signed photo uploads, thumbnail
generation, sockets and call signaling. Firebase token verification is a rejection
fixture; object storage and Google Places are local provider fixtures. Payments use
the existing mock provider. These tests do not prove real SMS/Google login, Supabase
availability/ACLs, bank settlement, notification delivery, or audio/video media.
RabbitMQ is disabled in this HTTP stack; the separate broker and persisted-flow
suites exercise queued mode and delivery recovery.

The runner closes service processes/storage, removes its Redis container and drops
its disposable database in `finally`. Results and cleanup evidence are under
`docs/full-flow-2026-11-14/`. The same command is now included in backend CI.
Run the Flutter suite separately from `genie` with `flutter test`.
