# Staging and production finalization check

Checked 6 November 2026, approximately 15:05–15:17 Cambodia time. **Result: not ready to finalize.**

This was a read-only infrastructure audit: Railway variables and active deployment snapshots,
Infisical secrets and sync destinations, PostgreSQL catalog queries and aggregate counts in
read-only transactions, public GET endpoints, and GitHub Actions logs and artifacts. No hosted
data, credentials, syncs, deployments, or GitHub settings were changed. No secret values are recorded here.

| Check | Result | Evidence |
|---|---|---|
| Separate PostgreSQL projects | PASS | Production `ovrwutngmsompqpchlgt`; staging `nzurymawikvamjjfbdmz`. All six database services' active snapshots target their respective project. Different server addresses and administrator passwords. |
| Database structure | PASS | Both have 31 app tables: account 7, listing 14, chat 5, notification 3, payment 1, public 1. All report RLS enabled. |
| Separate Redis | PASS | Distinct Railway environment deployments and credentials. Production Authentication's literal Redis URL matches production Redis, not staging Redis. |
| Current internal and JWT encryption secrets | PASS for separation | Different between environments. This does not mean their automated rotation is complete. |
| Infisical service sync destinations | PASS | Six enabled syncs map each production folder to the correct production service. None targets Staging or `/rotation`; all last syncs succeeded. |
| Storage isolation | FAIL | Production Authentication, Users, property, and Chat carry staging's Supabase URL and service-role key. Production's four stored listing-image URLs also use the staging host. Production Storage has no objects; staging has 132 across the three app buckets. |
| Production availability | FAIL | Gateway `/health` 200, JWKS 503, closest listings 500. Authentication and Notification logs show `ENETUNREACH` to production's IPv6 database address. |
| Production database credential rotation | FAIL | Every database service's active snapshot uses direct `db.ovrwutngmsompqpchlgt.supabase.co:5432` as `postgres`. All 12 rotating roles exist but have no passwords. All six old service roles still have LOGIN and passwords. |
| Shared-secret rotation delivery | FAIL | Infisical root contains the new current/previous secret, but no service uses that current value. Railway has no shared variables; services have literal current values and no previous value. There is no root/shared-variable sync. |
| Backup execution | PASS for the backed-up dataset | The latest job dumped, restored all 31 tables into disposable PostgreSQL 17, encrypted, and uploaded its artifact. |
| Production backup coverage | FAIL | The latest restored backup contains 112 users and 101 listings, matching staging. Production has 5 users and 14 listings. The current successful backup is not evidence of a production backup. |
| Full credential isolation | FAIL | `CHAT_BACKUP_SECRET` and Firebase service-account credentials are shared. The obsolete Authentication `JWT_SECRET` is also identical. Current JWT public/private variables differ between environments. |

Production and staging PostgreSQL data are separate, but the environments are **not fully isolated**.
The service roles' schema grants do not limit a service currently connecting as `postgres`.

The successful [Secret rotation run](https://github.com/GenieMapKH/GenieBackend/actions/runs/42184480880)
was a dry run: all six database tasks said `due`; `shared` said `not due`.
Infisical `/rotation` contains only `SHARED_ROTATED_AT`, dated 6 November 2026 at 14:57 Cambodia time.
It has none of the 12 database passwords or six service rotation timestamps. A real database rotation
will refuse the current `postgres` URLs and requires bootstrap first.

Infisical's root folder also contains imported service-specific values, including `DATABASE_URL`,
`SERVICE`, `PORT`, and `REDIS_URL`. Do not sync that entire folder into shared variables without
first limiting its contents to the intended shared secrets. Per-service folders currently contain
literal internal secrets too, which would override shared rotation unless changed to references.

Production Chat and payment additionally retain a staging `DIRECT_URL`. The inspected application
code uses `DATABASE_URL` at runtime, so this is a stale configuration hazard rather than evidence
that their normal SQL queries reach staging. The per-service `*_DATABASE_URL` variables still
name the old service roles; Railway applications read `DATABASE_URL` directly. Compose's fallback
behavior does not select those alternate variables for a Railway deployment.

The latest [Database backup run](https://github.com/GenieMapKH/GenieBackend/actions/runs/42185372775)
was manually dispatched at 15:06 Cambodia time. It produced
`tilomnov-db-2026-11-06T0807Z.dump.age`, artifact `13487775872`, 288,413 bytes,
with expiry 4 February 2027. The preceding successful run restored the same staging counts.
The configured daily backup time is 02:00 Cambodia time; rotation is 03:30.
Successful scheduled operation after the setup changes has not yet been demonstrated.

**Why the run backed up staging:** the workflow sets its dump connection from the GitHub Actions
repository secret named `BACKUP_DATABASE_URL` (`.github/workflows/database-backup.yml`). It does
not read Railway's per-service `DATABASE_URL`, Infisical's `/authentication` `DATABASE_URL`, or
the GitHub secret named `DATABASE_URL`. GitHub lists `BACKUP_DATABASE_URL` as last updated at
06:41 UTC and the separate `DATABASE_URL` as updated at 08:06 UTC. The successful 08:07 UTC backup
restored staging's 112-user/101-listing counts. The most direct explanation is that the new
production URL was saved under `DATABASE_URL` while `BACKUP_DATABASE_URL` still points at staging.
GitHub does not let the secret value be read back, so confirm the `BACKUP_DATABASE_URL` destination
by checking its Supabase project reference in the Actions settings, without copying the password
into logs or chat. Set that *specific* secret to the production administrator's session-pooler URL,
then run the backup manually and verify its counts match production before relying on it.

The backup workflow restores the plaintext dump before encrypting it. This proves the dump restores;
it does not prove the owner's offline identity can decrypt the uploaded artifact. The database dump
also excludes Supabase Storage objects, database-role passwords, and external secrets. Recovery of
chat backups needs the corresponding `CHAT_BACKUP_SECRET`, which must be recoverable independently.
The restore script recreates migration 34's roles but does not run migration 36; recovery with
rotating credentials must apply migration 36 and bootstrap those logins before services reconnect.

Both databases already contain sealed chat backups: production 5, staging 21. **Do not simply replace
`CHAT_BACKUP_SECRET`: existing verifier tags and encrypted backup blobs depend on it.** Separating
these secrets needs a migration or a deliberate user recovery/reset process. Likewise, changing
production's storage URL alone does not migrate the existing objects or stored image URLs.

The public repository's `origin/main` still tracks `backup-key.txt`, containing a valid X25519
private key. The working tree already has its deletion pending. Its public key **does not match**
the current `BACKUP_AGE_RECIPIENT`, so this finding does not establish exposure of the current backup
decryption key. Retire the tracked key wherever it was used and prevent private-key files from being
recommitted; deleting the working file alone leaves Git history intact.

Before finalization, complete these steps in order:

1. Establish a production backup using the production administrator session-pooler URL on port
   5432, then verify its restored counts against production. Give staging a separately named job
   and credential if its backups should continue. Prove offline-key decryption on an isolated target.
2. Correct each production folder's `DATABASE_URL` in Infisical to the production session pooler.
   Bootstrap both rotating logins per service, confirm sync delivery and successful redeploys,
   and verify each service's actual deployment snapshot uses its own `_1` login. Authentication
   must start and publish JWKS before checking the remaining services.
3. Make the root/shared-variable sync contain only the intended shared secrets; wire the current
   and previous references into each service that uses service tokens. Verify delivery before
   another shared rotation, including agreement on Authentication's JWT encryption key.
4. Exercise one real database rotation, verify the service moves to `_2` and remains functional,
   then retire the old service LOGIN credentials after confirming nothing uses them. Remove or
   correct the stale staging `DIRECT_URL` values and unused alternate database URLs in production.
5. Copy production-owned storage objects to production Storage, update the stored URLs, and switch
   the production storage credentials without breaking existing files. Arrange backup/recovery for
   those objects separately. Plan the chat-backup-secret separation around the existing encrypted data.
6. Verify the nightly jobs, an encrypted production backup recovery, and functional staging/production
   API checks. Then rerun the existing parity suite once the production outage is resolved.

Local validation: all 16 secret-rotation script tests passed. The audit did not run the write-producing
75-case parity suite while production was failing. It did not perform a new restore locally, access
the offline age identity, verify Firebase project separation, or audit the machine identity's full
permission policy. Database audit connections used encrypted session-pooler connections with libpq
`sslmode=require` semantics; full certificate/hostname validation was not established. Supabase's
[SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement) explains the verification modes.

The existing `docs/BACKUPS.md` edit and `backup-key.txt` deletion were present before this audit and
have been preserved. This report is the only file added by the audit.

## Follow-up after correcting the backup connection

The next restore log shows `account.users: 5`, `listing.properties: 14`, and all 31 tables restored.
That matches the production database counts recorded above. It is a **production** backup. The
same log's `schema ... already exists, skipping` messages are harmless migration notices.

A second, read-only comparison queried primary-key values in both live databases without printing
the IDs or user data. Of the 29 app tables with production rows, the only shared primary keys were
the 10 `listing.keywords` catalogue rows. Users, listings, and other app records have different IDs.
The keyword catalogue overlap is consistent with shared static reference data; it does not indicate
that production and staging use the same database.

The supplied excerpt ends after the restore step. Confirm the workflow continues through encryption
and artifact upload before counting this run as a completed backup.

## Authorized production wipe

On 6 November 2026, after the user explicitly confirmed `WIPE production ovrwutngmsompqpchlgt`,
cleared the 118 production app records in one transaction across the 29 application tables. The
transaction targeted the production session pooler after checking the tenant ref, current database
and administrator role. It aborted on any unexpected app-table change, row-count drift, or foreign
key reference outside the wipe scope; none occurred. It made no writes to staging or non-app schemas.

A separate read-only query after commit confirmed zero users, signing keys, refresh tokens, chat
backups, messages, and listings; it also confirmed all 10 keyword catalogue rows and the existing
Prisma migration record remained. Production Storage contained zero objects. Staging data and
Storage were left untouched.

Production `/health` still returns 200, but `/v1/auth/.well-known/jwks.json` returns 503 after the
signing-key rows were cleared. The production services were already unable to reach their direct
IPv6 database URL. Restore Authentication's production database connection through its session
pooler, redeploy/restart it so it generates a new signing key, and verify JWKS returns 200 before
expecting sign-in to work.

## Final readiness check

After the wipe, manually dispatched the [Database backup workflow](https://github.com/GenieMapKH/GenieBackend/actions/runs/42197126142).
All workflow steps passed: it dumped production, restored all 31 tables into the temporary
PostgreSQL check database, found 0 users, 0 listings, and 0 chat backups, encrypted the dump, and
uploaded `tilomnov-db-2026-11-06T0944Z.dump.age` (artifact `13492496988`, 90-day retention).
This confirms the configured backup target is the now-empty **production** project. Offline-key
decryption is still unverified, and Storage objects are not in these database backups.

At this check, staging remained separate (112 users, 101 listings, 132 Storage objects). Production
Postgres is on its own project and has no customer records, but its deployed services still use the
production direct IPv6 host and `postgres` login. The active production Supabase Storage URL and
service key still identify staging. Credential rotation is not deployed: rotating service logins
have no passwords, `/rotation` has no database passwords or per-service rotation dates, all six
service `DATABASE_URL` values remain administrator credentials, and no Railway services reference
the new/previous shared credentials. The latest successful rotation run was a dry run.

**Overall readiness: 3/10.** PostgreSQL project separation is strong; automated database backup
and restore now pass for the post-wipe state; production connectivity, per-service credentials,
storage separation, and automated rotation prevent sign-off. Production sign-in remains unavailable
until Authentication can reconnect, generate its fresh signing key, and serve JWKS successfully.
