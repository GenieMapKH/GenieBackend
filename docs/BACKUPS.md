# Database backups

The database is a Supabase project on the Free plan, which keeps **no backup you can restore**.
So a GitHub Action makes one every night (`.github/workflows/database-backup.yml`):

1. `pg_dump` (Postgres 17) of the app's schemas (`account`, `listing`, `chat`, `payment`,
   `notification`, and `public` for Prisma's bookkeeping): every table the app uses, its indexes,
   constraints and row level security. Over SSL only.
2. The dump is **restored into an empty Postgres 17 in the same job**, and the job fails unless every
   table came back. A backup that cannot be restored is not a backup.
3. It is **encrypted with [age](https://age-encryption.org) to your public key**. GitHub only ever
   stores the encrypted file; the private key that opens it never leaves your hands.
4. It is kept as a workflow artifact named `tilomnov-db-<date>.dump.age` for **90 days**.

At most a day of data can be lost (the time since the last backup), and the last 90 days of
nightly states can be restored.

## What is not in it

- **Files in Supabase Storage**: listing photos, avatars, chat attachments. The database only holds
  their names. Losing the project loses them.
- The schemas Supabase manages itself (`auth`, `storage`, ...). The app keeps its own users and
  sessions in `account`, so nothing of the app's lives there.
- The service logins' passwords. A restore recreates the logins (migration 34) without
  passwords: set them again (docs/DATABASE_SCHEMAS.md).
- Anything older than 90 days.

## Setting it up (once)

1. **Make a key pair** on your own computer ([download age](https://github.com/FiloSottile/age/releases)):

   ```
   age-keygen -o tilomnov-backup-key.txt
   ```

   It prints the public key (`age1...`). The file holds the private key.

2. **Keep the private key safe, in two places**: a password manager, and offline (a USB stick or a
   printed copy in a safe place). **Without it no backup can ever be opened**, and anyone who has it
   (with access to the GitHub repository) can read every backup. Never commit it.

3. In GitHub, repository **Settings → Secrets and variables → Actions**:
   - Secret **`BACKUP_DATABASE_URL`**: the database URL, as in `DATABASE_URL` in `.env` (the
     session pooler on port 5432). Prisma's `?pgbouncer=true` may stay: the script drops it.
   - Variable **`BACKUP_AGE_RECIPIENT`**: the public key, `age1...`.

4. **Actions → Database backup → Run workflow** to make the first one now, and check it is green.

If the repository is public, GitHub switches scheduled workflows off after 60 days without activity
in it; a push or a manual run switches them on again. Check now and then that last night's run is
green.

## Restoring

Restore into an **empty** database first (a new Supabase project, or a local Postgres 17), check it,
then point the services at it. The script refuses a target that already has tables, so it can never
overwrite live data.

1. Download the backup: **Actions → Database backup → a run → Artifacts**, then unzip it.
2. With `psql`, `pg_restore` (17) and `age` installed:

   ```
   TARGET_DATABASE_URL='postgresql://...empty database...' \
     scripts/restore-database.sh tilomnov-db-2026-10-20T1900Z.dump.age tilomnov-backup-key.txt
   ```

   It decrypts to a temporary file (deleted afterwards), creates `pg_trgm`, restores every table,
   recreates the service logins and their access, and prints the row count of each table.
3. Give the service logins passwords and point each service's `DATABASE_URL` at its own login on
   the new database (docs/DATABASE_SCHEMAS.md), then restart them.

Supabase's REST API only serves `public`, which holds no app data. The restored tables still
keep row level security on, as the live ones have it; a database built from the migrations alone
gets it from migration `24_row_level_security_everywhere`.

## Practise it

Once a month, restore the latest backup into a local or throwaway database. Each nightly run already
proves the dump restores; practising proves you can find the key and do it under pressure.
