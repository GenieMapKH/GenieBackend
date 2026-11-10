# Tilomnov Backend services

Backend for the Tilomnov property marketplace (NestJS monorepo, PostgreSQL via Supabase, Prisma, Redis).

## Services

| Service | Port | Responsibility | If it is down |
|---|---|---|---|
| `api-gateway` | 4000 | Only public entry point. Rate limiting, CORS, security headers, JWT check, reverse proxy. | Everything is unreachable |
| `authentication` | 4001 | Register, login, Google (Firebase) login, token refresh, sessions, password reset, account lifecycle. | No login, register or refresh; signed-in users keep working until their 15-minute token expires |
| `user` | 4002 | Profile, profile picture, username check; fans account hide/erase out to the other services. | Profile screens only |
| `property` | 4003 | Listings, photos, likes/favourites/views, nearby places, and the home screen's search. | Browsing, listings and search |
| `chat` | 4004 | Messages (REST + WebSocket), presence, key backups, attachments. | Messaging only |
| `payment` | 4005 | Starts a payment, settles it from the provider's webhook. | Publishing a listing only |

`shared` is a library, not a service: the database client, Redis, storage, token checks and the
service-to-service call helpers every service needs.

Only the gateway is exposed. The other services trust the `x-user-id` header the gateway sets
after verifying the JWT, so they must never be reachable from the internet. A service that is down
makes the gateway answer `503` for its own paths, naming the service; nothing else is affected.

```
Flutter app ──► api-gateway ──► authentication   (/auth/*)
                            ├─► property         (/public/*, /properties/*, /search/*)
                            ├─► user             (/users/*)
                            ├─► chat             (/chat/*, WebSocket)
                            └─► payment          (/payments/*)

user ──► property, chat       account erased / hidden: remove files, clear caches
payment ──► property          publish a listing, release it after a failed payment
authentication ──► user       account deactivated / deleted
```

Services call each other only through `/internal` routes, which the gateway never forwards. The
calls from `user` and `payment` are signed with `INTERNAL_SERVICE_SECRET` (HS256, one minute each);
the call from `authentication` carries a one-minute RS256 token naming the account. All services
share one Postgres database for now; each owns its tables and no service writes another's
(`payment` asks `property` to change a listing's status).

### Code layout (per service: feature first, then layer)

```
authentication/src/auth/
  credentials/     register + login with password
  social/          Google login via Firebase
  sessions/        token issuing, refresh rotation, sign-in, sign-out (immediate), logged-in devices
  account/         password, deactivate, delete (each asks for proof of identity)
  password-reset/  forgot / verify / reset
  mail/            sending email: the reset code, the new sign-in alert
  users/           the only place that touches the `users` table
user/src/users/    profile, profile picture, hiding and erasing an account's content
property/src/
  properties/      services/ (query, lifecycle, publication, images, engagement, guest sessions), internal/
  search/          places, listings and people, search history
chat/src/chat/     REST, WebSocket gateway, encrypted message storage, attachments
payment/src/payments/  checkout, webhook, provider adapter, client for the property service
shared/src/        prisma, redis, supabase, auth (who is calling), internal (service calls, health)
```

Rule of thumb: controllers only validate and delegate, services hold business rules,
repositories (or Prisma/Supabase calls) hold persistence.

## Run locally

```bash
cp .env.example .env            # then fill in the values
npm ci
npm run keys:generate          # paste the output into .env
npm run build                   # prisma generate + shared + every service
npm run start:auth & npm run start:user & npm run start:property &   npm run start:chat & npm run start:payment & npm run start:gateway
```

### With Docker (one container per service)

```bash
docker compose up -d --build      # rebuild changed layers; recreate changed services only
docker compose up -d --build --no-deps chat  # fastest when only chat changed
docker compose logs -f chat       # follow one service's logs
docker compose restart chat       # restart one service; the rest keep running
docker compose down --remove-orphans   # stop (and remove the old single-container setup)
```

Redis, seven services, one image definition (`Dockerfile`, chosen with `--build-arg SERVICE=...`).
Compose reads `.env` by default. Fill in `INTERNAL_SERVICE_SECRET` and the other
required settings from `.env.example`, including all six dedicated database logins:
`AUTHENTICATION_DATABASE_URL`, `USER_DATABASE_URL`, `PROPERTY_DATABASE_URL`,
`CHAT_DATABASE_URL`, `PAYMENT_DATABASE_URL`, and `NOTIFICATION_DATABASE_URL`.
The shared `DATABASE_URL` does not substitute for these service credentials.
See [database service logins](docs/DATABASE_SCHEMAS.md) for their permissions and setup.

Validate the configuration without printing secrets or starting containers:

```bash
docker compose config --quiet
```

Keep local development on staging credentials. `.env.prod-db` is a separate
production configuration; Compose does not load it automatically.

The build caches dependencies, Prisma generation and the shared library separately. A source edit
in `chat` compiles only Chat; unchanged services reuse their existing image layers. Changes to
`shared` or the Prisma schema rebuild the services that use them. npm downloads are cached even
when a dependency change requires a fresh install. Local logs, coverage and TypeScript build
metadata are excluded from the build context. Local Compose builds disable provenance attestations
so a cached build keeps the same image ID instead of triggering container recreation solely due to
new build metadata. This requires Docker Compose 2.39+; Railway builds keep their default metadata.

Use `up -d --build` after backend code changes; plain `up -d` does not rebuild existing images.
Avoid `down`, `--no-cache`, `--force-recreate` and clearing the build cache during routine updates:
they discard running containers or reusable work. The first build after changing the Dockerfile
warms the new cache; subsequent updates benefit from it.
Only port 4000 is published. Each container restarts by itself (`restart: unless-stopped`).
Deploying to Railway: see [docs/RAILWAY.md](docs/RAILWAY.md). Nightly encrypted database backups and how to
restore one: see [docs/BACKUPS.md](docs/BACKUPS.md).

### Redis: cache, limits, chat between instances

Redis never holds the only copy of anything. If it is unreachable the services keep working:
reads go to the database, limits are counted per instance in memory, chat still delivers between
sockets on the same instance.

| Cached | Expires | Cleared at once when |
|---|---|---|
| Map search (`/public/properties/map`) and its price bars (`/map/prices`), per ~1 km grid box and filter | 30 s | a published listing inside it (in the same ~11 km cell) is created, edited, moved, published, hidden, sold, paid for, or gets photos, or its owner's name or picture changes. A map wider than 64 cells is cleared by any such change |
| Positions ranked by `/public/properties/closest`, per filter | 30 s | any published listing changes |
| Text search listings / one owner's listings | 30 s | any published listing changes / one of that owner's does |
| Listing page (`/public/properties/:id`) | 60 s | that listing changes, or its owner's name or picture does |
| Chat public key (`/chat/keys/:userId`) | 10 min | that user publishes a new key, or their account is hidden, shown again or deleted |
| Public profile (`/users/:id`) | 2 min | that user edits their profile or picture, or their account is hidden, shown again or deleted |

Redis also holds the sessions that were signed out (`sessions:revoked:<id>`, 15 minutes each, and
a `sessions:revoked` channel), see "Sessions, password and account".

Only data that is the same for every viewer is cached; `isVisited` is looked up per user. Map
searches are widened to the grid box (the app asks for the box already widened, so nearby positions
reuse its in-memory answer too), so the answer can contain listings just outside the viewport.

The gateway gzips responses for clients that accept it (the app does): a map answer of 500 listings
shrinks several times.

Also in Redis: the gateway's 300 requests/minute per address, login and reset-code attempt limits,
chat send / upload / backup-lookup limits, and the Socket.IO adapter that relays chat events and
presence between instances.

### Running more than one instance

1. Point every instance at the same external Redis (`REDIS_URL`). The Redis inside the container
   is private to that container.
2. Keep the sum of every service's instances x `DATABASE_POOL_MAX` (default 2) under
   the database pooler's session limit, including space for a rolling replacement.
3. Clients must connect to chat with the `websocket` transport only (the app does); long-polling
   would need sticky sessions.
4. Every service closes its connections on `SIGTERM`, so instances can be replaced one at a time.

Check it: `curl http://localhost:4000/health` should return `{"status":"ok"}`.

## Tests

```bash
npm test          # runs the tests of every service
```

## Database migrations

`prisma/schema.prisma` is the source of truth; every change needs a migration in `prisma/migrations`.

```bash
npx prisma migrate dev --name <what_changed>   # create + apply locally
npx prisma migrate deploy                      # apply on staging / production
```

The Prisma CLI cannot connect through the pooled `DATABASE_URL` of the hosted database, and no
deploy step applies migrations. There, apply them by name, in order:

```bash
node scripts/apply-migrations.js 7_user_profile_fields 8_refresh_token_sessions 9_account_lifecycle 10_password_flag_and_full_erase
```

The named migrations run in one transaction (all or nothing), and each is written to be safe to
run again. **Apply a migration before starting a build that needs it:** the services read the new
columns as soon as they start.

`2_complete_schema` is idempotent: it creates whatever is missing and skips what already exists.
If a database was built by hand and `_prisma_migrations` does not list `0_init`, mark it first:
`npx prisma migrate resolve --applied 0_init`.

## API overview

All routes go through the gateway. JWT = `Authorization: Bearer <accessToken>`.

Every path below is called under the API version: `/v1/auth/login`, `/v1/users/me`. The chat
socket sends `apiVersion: '1'` with its token. App builds from before versioning call the paths
without `/v1` and are answered as v1. How versions are added and retired:
[docs/API_VERSIONING.md](docs/API_VERSIONING.md).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | – | `{phone, email?, name?, password}`: phone required, stored as E.164 (`012 345 678` → `+85512345678`) |
| POST | `/auth/login` | – | `{email|phone, password}` → `{accessToken, refreshToken}`; reactivates a deactivated account |
| POST | `/auth/firebase-login` | – | `{idToken}` → tokens |
| POST | `/auth/refresh` | – | `{refreshToken}` → new pair (old one is revoked) |
| POST | `/auth/logout` | – | `{refreshToken}` |
| GET | `/auth/sessions` | JWT | logged-in devices (see below) |
| DELETE | `/auth/sessions/:id` | JWT | sign one device out, at once; `403` from a device signed in for less than a day, `404` if it is not the caller's |
| POST | `/auth/logout-all` | JWT | sign every device out, the caller's included; `403` as above |
| POST | `/auth/change-password` | JWT | `{currentPassword, newPassword}`; other devices are signed out. `403 DEVICE_TOO_NEW` from a device signed in for less than a day |
| POST | `/auth/account/password` | JWT | `{idToken, newPassword}`: the first password of a Google account |
| POST | `/auth/account/email` | JWT | `{email, password}`: adds an email to an account that has none. `409` if it has one or the email is taken; `403 DEVICE_TOO_NEW` as above |
| POST | `/auth/account/password-proof` | JWT | `{password}` → `{proofToken, expiresInSeconds}`, for sensitive account actions |
| POST | `/auth/account/deactivate` | JWT | `{password}` or `{idToken}`; hides the account until the next sign-in. `403 DEVICE_TOO_NEW` as above |
| POST | `/auth/account/delete` | JWT | `{password}` or `{idToken}`; deletes the account and its files for good. `403 DEVICE_TOO_NEW` as above |
| POST | `/auth/forgot-password`, `/auth/verify-otp`, `/auth/reset-password` | – | password reset |
| GET | `/public/properties/map` | optional | `minLat,maxLat,minLng,maxLng`; optional filter: `propertyType`, `listingType` (repeatable: any of), `minPrice,maxPrice` (USD, asking price), `minSize,maxSize` (m², land else unit else building size), `keyword` (repeatable: all of) |
| GET | `/public/properties/map/prices` | no | the same as the map search plus `upTo` (USD): `{ counts }`, 60 bars of asking prices from 0 to `upTo` (last bar includes above), ignoring the price range |
| GET | `/public/properties/closest` | optional | `lat,lng` (the user, or the map centre), `limit` (1-50, default 20), `offset`, and the map search's optional filter: `{ items, nextOffset }`, every published listing with a position, nearest first, each with `distanceMeters`. Ranks at most the newest 20,000; past that it needs a spatial index |
| GET | `/public/properties/:id` | – | published property |
| POST | `/public/properties/guest-session` | – | `{deviceId}` |
| `*` | `/properties/...` | JWT | own listings, images, like, favorite, contact |
| GET / PATCH | `/users/me` | JWT | profile (see below) |
| GET | `/users/username-available` | JWT | is this username free (see below) |
| POST / PUT / DELETE | `/users/me/avatar...` | JWT | profile picture (see below) |
| GET / PUT / DELETE | `/users/:id/follow` | JWT | follow counts / follow / unfollow; each answers `{ followerCount, followingCount, isFollowing }` (see docs/SYSTEM_DESIGN.md 9a) |
| GET | `/feed?limit=&cursor=&sort=&since=&until=&propertyType=&minPrice=&maxPrice=` | JWT | followed listings sorted by newest, saves or buyer price, with date/category/price filters: `{ items, nextCursor }` (see docs/SYSTEM_DESIGN.md 9a) |
| POST | `/properties/:id/lead` | JWT | `{ channel: call\|chat }`: a buyer tapped Call or Chat (204; once per person and channel; see docs/SYSTEM_DESIGN.md 9) |
| GET | `/properties/:id/insights` | JWT, owner | `{ totals: { views, saves, calls, chats }, days: [{ date, views, saves, leads }] }` for the last 14 days |
| GET / PUT / DELETE | `/users/:id/block` | JWT | block status / block / unblock; each answers `{ isBlocked, canMessage }` (see docs/SYSTEM_DESIGN.md 9b) |
| GET | `/users/me/blocks` | JWT | the accounts you blocked, newest first: `[{ id, name, username, avatarUrl, blockedAt }]` |
| POST | `/reports` | JWT | report a listing or an account: `{ targetType: listing\|user, targetId, reason, details? }` -> `{ id, status, createdAt }`; the same open report again answers the same one |
| GET / PATCH | `/reports/admin`, `/reports/admin/:id` | JWT, admin | the review queue `?status=&limit=&cursor=`, and resolving or dismissing one `{ status, note? }` |
| `*` | `/chat/...` | JWT | keys, backup, conversations, messages |
| POST | `/payments/checkout` | JWT | `{propertyId, requestId, method?}` → server-recorded mock purchase; unavailable unless staging/development mock mode is enabled |
| POST | `/payments/subscriptions/checkout` | JWT | `{tier, method, requestId}` → server-recorded subscription purchase |
| GET | `/payments/subscriptions/current` | JWT | current paid period or `null` under `subscription` |
| POST | `/payments/subscriptions/cancel` | JWT | stops renewal; retains the paid plan until its expiry |
| GET | `/payments/transactions/:id` | JWT, owner | transaction ID and payment status |
| POST | `/payments/webhook` | signature | called by the payment provider |
| GET | `/health` | – | liveness |

Errors use Nest's standard shape: `{ statusCode, message, error }`.
Unknown body fields are dropped and invalid ones return `400`.

## Profile

`GET /users/me` → `{ id, email, phone, username, name, firstName, lastName, sex, role,
createdAt, firebaseUid, avatarUrl, avatarFromGoogle, hasPassword }`. `PATCH /users/me` changes
only the fields it is sent; `null` or an empty string clears one (never `username`).

- `hasPassword` is `false` for an account made by Google sign-in whose owner has not created a
  password yet (`users.has_password`). Such an account cannot prove itself with a password.
- `avatarFromGoogle` is `true` while the picture is the Google account's photo.

| Field | Rule |
|---|---|
| `username` | The unique handle: 3-30 of `a-z 0-9 _ .`, stored lowercase. `409` `Username is already taken`. Every new account is given a random unused one (`user_<10 hex>`, drawn by the database; sign-up retries if it ever collides), which the owner can change. |
| `name` | What people see. Up to 60 characters, not unique. Google sign-in fills it in. |
| `firstName`, `lastName` | Up to 50 characters each. |
| `sex` | `male`, `female` or `other`. |
| `phone` | Unique. `409` `Phone number is already taken`. |

`GET /users/username-available?username=` (JWT) → `{ username, available, reason }` where `reason` is
`null`, `"taken"` or `"invalid"`. It compares the name the way it would be saved (trimmed, lowercase)
and counts the caller's own current username as available. The app calls it while the user types;
it is advice only: two people can be told the same free name, and the save (`PATCH /users/me`) is
what decides, answering `409` to the second. Limited to 60 checks per user per minute.

`GET /users/:id` (JWT) returns another user's public profile: `{ id, username, name, avatarUrl,
createdAt }`, never contact details. A deactivated account answers `404`.

**Profile picture.** It is either a file uploaded to the public `avatars` bucket (one folder per
user, 2 MB per file) or the Google account's photo. It cannot be set to any other URL: every app
that shows a user loads their picture, so a URL of the user's choosing would tell that server who
is looking.

| Method | Path | Purpose |
|---|---|---|
| POST | `/users/me/avatar/upload` | → `{ path, uploadUrl }`: a signed URL to PUT one image to (10 per user per minute) |
| PUT | `/users/me/avatar` | `{ path }`: use the uploaded file. `400` if it is not in the caller's folder or was not uploaded |
| PUT | `/users/me/avatar/google` | `{ photoUrl }`: "Sync from Google account". Must be a `*.googleusercontent.com` photo |
| DELETE | `/users/me/avatar` | no picture |

Each returns the profile. The file that was replaced is deleted. Other people see a changed name
or picture at once: the public profile and the owner details on the user's published listings are
dropped from the cache, and chat lists read both live. While the picture is a Google
photo, every Google sign-in updates it to the account's current photo; a picture the user uploaded
or removed is never overwritten.

## Sessions, password and account

**Logged-in devices.** A session is one sign-in on one device. `GET /auth/sessions` →
`{ sessions: [{ id, deviceName, platform, ipAddress, location, signedInAt, lastUsedAt, current }],
canSignOutOthers, canSignOutOthersFrom }`, most recently used first; `current` marks the device
that asked.

- The app describes itself on every `/auth` call with `X-Device-Name` and `X-Device-Platform`
  (URL-encoded, at most 100 characters). The gateway writes the caller's address to
  `X-Client-IP`, replacing anything a client sent.
- `location` ("Phnom Penh, Cambodia") is looked up from the IP address after the response is
  sent, so it is `null` at first, and stays `null` for a private address (local testing) or when
  the lookup fails. `IP_LOCATION_API_URL` selects the lookup server or switches it off.
- `lastUsedAt` moves when the device refreshes its token, so it is accurate to about 15 minutes.
- **Signing a device out takes effect at once.** An access token is valid on its signature alone
  and lives 15 minutes, so every sign-out also writes the session to Redis
  (`sessions:revoked:<session id>`, kept 15 minutes) and announces it on the `sessions:revoked`
  channel. The gateway checks that list on every request, the authentication service on its own
  routes, and the chat server at the handshake and on every message; on the announcement it
  closes the device's open chat connections. Without Redis the check cannot be made and a
  signed-out device works until its token expires, as before; it can never renew it.
- **The one-day rule.** Only a device that has been signed in for 24 hours may take the account
  away from its other devices: sign them out, change the password, deactivate or delete the
  account. From a newer device those answer `403` with `code: "DEVICE_TOO_NEW"` and
  `canSignOutOthersFrom` (the list reports the same as `canSignOutOthers`). Someone who just got
  into an account, even with its password, cannot lock the owner out, while the owner's older
  devices can remove the newcomer. A device can always sign itself out, and "forgot password" by
  email is not affected: it proves ownership of the email, not of a device.
- **New sign-in alert.** When someone signs in while the account already has an active session,
  the owner is emailed (device, time, IP address), if the account has an email. The app also
  compares the device list on its side and tells the user on their other devices.
- Sessions live in `refresh_tokens`: every refresh adds a row that copies the session's columns
  from the row it replaces. Tokens issued before migration 8 have no session and are not listed
  until that device refreshes once.

**Proof of identity.** Changing the password, deactivating and deleting need more than an access
token: the password, or for a Google account an `idToken` from signing in with Google again
within the last 5 minutes. A wrong proof is `403` (never `401`, which the app treats as "session
expired"); after 10 wrong tries in 15 minutes the answer is `429`.

**A Google account's password.** An account made by Google sign-in has no password
(`hasPassword: false`). `POST /auth/account/password` `{idToken, newPassword}` gives it one,
confirmed by a fresh Google sign-in; "forgot password" by email does the same.

**Password proof.** `POST /auth/account/password-proof` `{password}` → a token valid for
5 minutes that says the password was just typed. The chat service accepts it where only the
password can vouch for the owner (sensitive account actions). It is not an access token.

**Deactivate** sets `users.deactivated_at` and signs every device out. From that moment the
account is hidden from everyone else: its public profile and chat key answer `404`, its listings
leave the map, the listing pages and other people's saved lists, and its conversations leave
their chat lists. Nothing is deleted; signing in again brings it all back at once.

**Delete** removes every trace, in this order: the account is hidden; the user service has the
property, chat and user services delete its files from storage (listing photos, chat attachments in
both directions, profile pictures);
its sessions end; its Google sign-in record in Firebase and its password-reset codes are removed;
the `users` row is deleted, and the database deletes everything that hangs off it (listings,
favourites, contact requests it sent, chat messages and keys, payment records). If the files
cannot be removed the answer is `503`, nothing is deleted and the account is shown again.

**Calls between services.** For the two actions above the authentication service calls the user
service directly at `USER_SERVICE_URL`: `DELETE /internal/accounts/:id/files` and
`POST /internal/accounts/:id/visibility-changed`. The gateway does not forward `/internal`, and
each call carries a one-minute token signed with the JWT key and naming the account.

## Chat

Chat uses authenticated TLS/WSS in transit and AES-256-GCM encryption in server storage.
New messages require no PIN or device identity keys. The client uses the existing transport
fields `ciphertext` (base64 JSON) and `nonce: "managed-v1"`; base64 is transport encoding,
not encryption. The server validates the envelope's id, sender and recipient before encrypting
it with a fresh IV. Encryption binds all three identifiers as authenticated data.

Set a distinct, stable `CHAT_MESSAGE_SECRET` of at least 32 characters in each environment.
Keep it outside the database and back it up separately. Losing or replacing it without
rewrapping stored messages makes those messages unreadable. `npm run keys:generate` prints
a fresh value for initial setup; do not rotate it by simply replacing it.

All `/chat` REST routes and Socket.IO messages require a valid access token. Conversation
membership, blocking, account visibility, rate limits, edit windows, reply visibility and
per-user deletion checks still apply. Attachments remain encrypted in private storage; their
per-file keys travel inside the server-encrypted message. Push payloads carry no readable text.

| Method | Path | Purpose |
|---|---|---|
| GET | `/chat/conversations` | Main or archived conversations; optional pagination |
| GET | `/chat/messages/:participantId` | Message history for the signed-in participant |
| POST | `/chat/messages/:participantId/read` | Mark received messages read |
| POST | `/chat/messages/:messageId/edit` | Edit the sender's message within one hour |
| POST | `/chat/messages/:messageId/delete` | Delete for the caller or, for the sender, everyone |
| POST | `/chat/conversations/:participantId/archive` | Archive for the caller |
| POST | `/chat/conversations/:participantId/unarchive` | Restore to the caller's main list |
| POST | `/chat/conversations/:participantId/delete` | Clear conversation history |
| POST | `/chat/attachments` | Create a signed upload URL |
| GET | `/chat/attachments/:senderId/:recipientId/:fileId` | Participant-only signed download URL |

Socket.IO retains `sendMessage`, `newMessage`, message edits/deletes and presence events.
The client supplies a UUID `id`; retries return the same stored message.

The previous `/chat/keys*` and `/chat/backup*` routes are removed. Older message ciphertext
and backup rows remain stored. Older message bodies are withheld from API responses and
appear as unavailable in the app; no recovery or PIN prompt is offered. Deploy the server
with its message secret before distributing the new app; older-format sends are refused.

## Payments (mock)

The provider adapter (`payment/src/payments/aba-payway.provider.ts`) is a mock; no real gateway is
integrated yet. The flow around it is production-shaped:

- only the owner can start checkout, and only from a publishable status;
- the webhook must carry `x-signature` = hex `HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, "<transactionId>|<status>")`;
  without `PAYMENT_WEBHOOK_SECRET` every webhook is rejected;
- a transaction is settled once; repeated or racing webhooks are ignored;
- on failure the property goes back to `Draft`.

The payment and the listing live in different services, so the flow is a short saga instead of one
database transaction (the listing's status is only ever changed by the property service):

1. checkout asks property to check the owner and status and park the listing as `Pending`, then
   records the transaction; if recording fails the listing is put back to its previous status;
2. the webhook switches the transaction `Pending` → final (only one webhook can win), then tells
   property to publish (`Active`) or release (`Draft`) the listing;
3. if property cannot be told, the switch is undone and the webhook answers `503`, so the provider
   sends it again. A paid listing is never left unpublished behind a transaction that looks settled.

## Security notes

- Secrets live only in environment variables (see `.env.example`). Never commit `.env`.
- Refresh tokens rotate on every use. A revoked token presented again while its session has a
  newer token means it was stolen: all of the user's sessions are revoked. A token of a session
  that was signed out is simply refused.
- A signed-out session's access token is refused at once (see "Sessions, password and account").
- Calls between services are signed with `INTERNAL_SERVICE_SECRET` (HS256, 60 s, `typ=service`, the
  sender named in `iss`); each `/internal` route accepts only the senders it lists, and the gateway never
  forwards `/internal`.
- Every user token is signed with the same key and says what it is in `typ` (`access`, `refresh`,
  `password-proof`, `internal`); each place that accepts a token accepts exactly one kind.
- Self-registration always creates role `user`.
- Password-reset codes are generated with a CSPRNG and stored hashed.

## Uploaded files

Files never pass through the gateway or the services: the app asks for a signed upload URL and
sends the file straight to Supabase storage. What keeps a large file out is therefore the bucket's
size limit, applied by the service that owns the bucket (user: `avatars`, property: `property-images`, chat: `chat-attachments`) when it starts (and to buckets that already existed, which
keep the limits they were made with otherwise).

| Bucket | Holds | Limit | What the app sends |
|---|---|---|---|
| `avatars` | profile pictures | 2 MB | JPEG under 1 MB |
| `property-images` | listing photos | 8 MB | JPEG under 4 MB |
| `chat-attachments` | encrypted chat files | 12 MB | encrypted JPEG under 3 MB |

The app compresses every picture before upload (see its README), so the limits are a safety net
for a client that does not. Changing a limit means changing the constant next to the code that
owns the bucket and restarting that service. The server cannot compress chat files: they are
encrypted on the sender's device and the server never sees them readable.
