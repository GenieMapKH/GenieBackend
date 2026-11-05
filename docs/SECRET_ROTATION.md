# Secret rotation

Which secrets rotate by themselves, and how to rotate the rest.

| Secret | Rotation | Where it lives |
|---|---|---|
| Token signing keys (RS256) | **automatic**, every 30 days | `account.jwt_signing_keys`, private halves encrypted |
| `JWT_KEY_ENCRYPTION_KEY` | **automatic**, every 30 days (section 2) | `authentication` only |
| `INTERNAL_SERVICE_SECRET` | **automatic**, every 30 days (section 2) | every service |
| Database passwords (`<service>_service_1/_2` logins) | **automatic**, every 30 days (section 2) | each service's `DATABASE_URL` |
| Firebase, PayWay, Sentry, email keys | by hand, in each provider's dashboard (section 3) | the services that use them |

Railway does not rotate anything itself. It only stores variables, and a changed variable takes effect
when the service redeploys. Infisical holds the production values and syncs them into Railway; the
rotation in section 2 is ours (Infisical's own rotation needs its paid plan).

## 1. Token signing keys (automatic)

The authentication service owns its keys (`authentication/src/auth/signing-keys`):

- On start, and every 5 minutes, it checks the keys. With none it can sign with, it creates one at once.
  After `JWT_KEY_ROTATION_DAYS` (default 30) it creates the successor, publishes it, and starts signing
  with it **1 hour later**, so every service has fetched it by then.
- A retired key stays **published** for 20 minutes, until the last access token it signed (15 minutes)
  has expired. The authentication service **keeps** it for 31 days, so refresh tokens it signed still
  refresh. Nobody is signed out by a rotation. After that the row is deleted.
- Replicas take turns on a Postgres advisory lock, so two of them never create a key each.
- Private keys are stored AES-256-GCM-encrypted under `JWT_KEY_ENCRYPTION_KEY`. A database dump or
  backup alone cannot sign tokens.
- Tokens carry the key's id (`kid`) in their header. Every other service fetches the public keys from
  `GET {AUTH_SERVICE_URL}/v1/auth/.well-known/jwks.json` (`AuthKeySet` in `shared`), caches them for
  10 minutes, fetches again when a token names an unknown key (at most every 30 s), and keeps the cached
  keys while the auth service is down. A service that has never loaded keys answers `503`, never `401`,
  so the app does not sign the user out.

Variables:

| Name | Where | |
|---|---|---|
| `JWT_KEY_ENCRYPTION_KEY` | `authentication` | **required**: 32 random bytes, base64 (`npm run keys:generate`). The same value in every replica of one environment; a different value per environment |
| `AUTH_SERVICE_URL` | **every** service | where to fetch the keys, e.g. `http://authentication.railway.internal:4001` |
| `JWT_KEY_ROTATION_DAYS` | `authentication` | optional, default 30 |
| `JWT_PUBLIC_KEY` | `authentication` | only for the switch to rotation (below); remove it afterwards |
| `JWT_PRIVATE_KEY` | nowhere | no longer read; delete it |

### Switching an environment to rotation (once)

1. Apply migration 35: `node scripts/apply-migrations.js 35_jwt_signing_keys`.
2. Set `JWT_KEY_ENCRYPTION_KEY` on `authentication`, and `AUTH_SERVICE_URL` on `user`, `property`,
   `chat`, `payment` and `notification` (the gateway already has it).
3. Deploy `authentication` first, then the others.

On its first start the service creates a fresh key and imports `JWT_PUBLIC_KEY` as the key `legacy`.
It never signs with it again, but tokens issued before the switch (they carry no `kid`) keep working:
access tokens for their last 15 minutes, refresh tokens until their next refresh. 31 days later the
row is deleted, and `JWT_PUBLIC_KEY` and `JWT_PRIVATE_KEY` can be removed from Railway.

**If the old key may have leaked** (the Railway incident of 21 October 2026), skip the import: delete
`JWT_PUBLIC_KEY` from `authentication` **before** step 3. Everyone signs in once more, and a forged
token signed with the old key is refused from the first minute.

### Emergency: a signing key leaked

Remove `JWT_PUBLIC_KEY` from `authentication` if it is still set (an empty table imports it again),
delete every key and restart `authentication`. It creates a new key on start. Everyone signs in again.

```sql
DELETE FROM account.jwt_signing_keys;
```

The other services drop the deleted keys within 10 minutes. Until then a forged token signed with
a deleted key would still pass them; restart them as well to cut that to zero.

### Rotating `JWT_KEY_ENCRYPTION_KEY`

Set a new value and redeploy `authentication`. It cannot decrypt the stored private keys any more, so
it creates a new signing key at once. The old public keys keep verifying, so nobody is signed out.
If the old encryption key leaked **together with** a database copy, use the emergency step above instead.

## 2. Everything else that is ours: the nightly rotation job

`.github/workflows/secret-rotation.yml` runs `scripts/secret-rotation/run.js` every night at 03:30
Cambodia time. It rotates what last rotated 30 or more days ago (`SECRET_ROTATION_DAYS`) and writes
the new values to Infisical, whose Railway syncs deliver them. A failed run turns the workflow red
(GitHub emails you) and never leaves a service without a working credential.

**Database passwords.** Each service has two logins, `<service>_service_1` and `_2` (migration 36),
both members of its `<service>_service` role, so both have exactly its permissions. The service runs
on one. The job:

1. logs in as the **other** login, and stops if anything else is connected as it (a service that has
   not redeployed since the last rotation: changing the password would cut it off);
2. saves the new password to Infisical (`/rotation`), then sets it: the login changes its **own**
   password, sent as a SCRAM verifier, so the plain password never reaches Postgres or its logs;
3. proves the new login works, then rewrites the service's `DATABASE_URL` (one secret: Railway never
   gets a new user with an old password). The service redeploys onto it.

The login left behind keeps its password for 30 more days, so a slow redeploy breaks nothing. No
credential the job holds can change another login's password, and the job has no admin login.

**`INTERNAL_SERVICE_SECRET`.** The current value moves to `INTERNAL_SERVICE_SECRET_PREVIOUS`, which
every service also accepts, then a new value is set. Services redeploying at different times keep
trusting each other.

**`JWT_KEY_ENCRYPTION_KEY`.** Replaced. On its next start the authentication service cannot read the
stored private keys, so it creates a new signing key (section 1). Nobody is signed out.

### Where things live in Infisical (production environment)

| Folder | Synced to | Holds |
|---|---|---|
| `/` | Railway **shared variables** (sync with no service, subfolders **off**) | `INTERNAL_SERVICE_SECRET`, `INTERNAL_SERVICE_SECRET_PREVIOUS` |
| `/authentication`, `/user`, `/property`, `/chat`, `/payment`, `/notification` | that Railway service | its `DATABASE_URL`, plus its own secrets (`JWT_KEY_ENCRYPTION_KEY` in `/authentication`) |
| `/rotation` | **nothing**: never sync it | each login's password, `*_ROTATED_AT` |

### Setting it up (once)

1. **Database.** Apply the migrations with the `postgres` login:
   `node scripts/apply-migrations.js 35_jwt_signing_keys 36_rotating_service_logins`.
2. **Infisical folders and syncs.** In the production environment create the folders above. Add one
   Railway sync per service folder, and one for `/` with the service left empty. For the first sync
   choose **Import from Railway, prioritize Railway**. Never choose *Overwrite Railway*: it deletes
   `SERVICE`, `PORT`, `HOST` and reference variables. Each service's `DATABASE_URL` must be the
   **session pooler** URL (`aws-0-<region>.pooler.supabase.com:5432`): the direct `db.<ref>.supabase.co`
   host is IPv6-only and GitHub cannot reach it.
3. **Railway.** In every service add the shared variables `INTERNAL_SERVICE_SECRET` and
   `INTERNAL_SERVICE_SECRET_PREVIOUS` (`${{shared.NAME}}`), unless the service already has them.
4. **Machine identity.** In Infisical create one with Universal Auth and read/write access to the
   production environment only. In GitHub (Settings > Secrets and variables > Actions) add secrets
   `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` and variables `INFISICAL_PROJECT_ID`,
   `INFISICAL_ENVIRONMENT` (the slug, e.g. `prod`), and `INFISICAL_API_URL` if you are not on
   `https://app.infisical.com`.
5. **Bootstrap** on your own machine, with the same variables plus the `postgres` login:
   `ADMIN_DATABASE_URL=... node scripts/secret-rotation/bootstrap.js`. It gives every login a
   password and switches each `DATABASE_URL` to `_1`. Watch every service redeploy and stay healthy.
   (`--only=chat` does one service; the admin login is not stored anywhere.)
6. **Retire the old logins.** Once every service runs on `_1`, the old passwords (`.env.prod-db`,
   and whatever Railway held before) must stop working:
   `ALTER ROLE authentication_service NOLOGIN;` and the same for `user_service`, `property_service`,
   `chat_service`, `payment_service`, `notification_service`. They stay as the groups that hold the
   permissions.
7. **Try it.** Actions > Secret rotation > Run workflow with *dry run*, then once with *force* and
   *only* = `notification`. Check the service redeployed on `notification_service_2`.

### When the job fails

- **"still has N open connection(s)"**: a service never redeployed onto its current login. Redeploy it
  (or check that its Railway sync redeploys on change); the next nightly run rotates it.
- **"the new password does not work yet"**: nothing switched; the next run retries.
- **"cannot log in as ..."**: the saved password in `/rotation` is wrong. Rerun
  `bootstrap.js --force --only=<service>`.

### By hand, at any time

Actions > Secret rotation > Run workflow, *force* on, *only* = the names to rotate now (for example
after a suspected leak).

## 3. Provider keys

Provider keys (Firebase service account, PayWay, Sentry DSN, email API keys) can only be reissued in
each provider's dashboard. Issue the new one, update the variable, redeploy, then revoke the old one.
