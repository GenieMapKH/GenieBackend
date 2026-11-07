# Database schemas and service logins

One Postgres instance, one **schema per service**, and one **database login per service**
(migration `34_service_schemas`). Each service can only reach its own tables, so moving a
service to its own database later is a matter of copying its schema and changing its
`DATABASE_URL`, plus the cross-schema reads listed below.

## Who owns what

| Schema | Owner service(s) | Tables |
|---|---|---|
| `account` | authentication, user | `users`, `refresh_tokens`, `password_reset_otps`, `follows`, `user_blocks`, `reports` |
| `listing` | property | `properties`, `property_images`, `property_likes`, `property_favorites`, `property_views`, `property_contacts`, `property_leads`, `property_nearby_places`, `property_keywords`, `keywords`, `saved_searches`, `saved_search_matches`, `search_history`, `guest_sessions` |
| `chat` | chat | `messages`, `chat_key_backups`, `chat_conversation_states`, `chat_hidden_messages`, `call_logs` |
| `payment` | payment | `payment_transactions`, `subscriptions` (migration 37) |
| `notification` | notification | `push_devices`, `notification_preferences`, `promotions` |
| `public` | nobody | `_prisma_migrations` only; `pg_trgm` lives here too |

Each Prisma model names its schema (`@@schema("...")` in `prisma/schema.prisma`). Raw SQL
must name it too (`FROM listing.properties`), because the service logins have no search path
into the service schemas.

## What each login may do

| Login | Access |
|---|---|
| `authentication_service` | read/write `account.users`, `account.refresh_tokens`, `account.password_reset_otps`. The only one that creates or deletes accounts. |
| `user_service` | read/update `account.users`; read/write `account.follows`, `account.user_blocks`, `account.reports` |
| `property_service` | read/write all of `listing`; **read** `account.users` |
| `chat_service` | read/write all of `chat`; **read** `account.users`; **update** only `identity_public_key`, `backup_blob`, `backup_salt`, `backup_nonce`, `last_seen_at` on it |
| `payment_service` | read/write all of `payment` |
| `notification_service` | read/write all of `notification`; **read** `account.users` |

The logins have `BYPASSRLS`: row level security stays on everywhere to keep Supabase's
public API keys out, not the services. They cannot create or alter tables: schema changes
run as `postgres` through `scripts/apply-migrations.js`. A new table in `listing`, `chat`,
`payment` or `notification` is granted to its owner automatically; a new table in `account`
needs its grants written in its migration.

Run migrations from `genie-backend` against staging using `.env`:

```sh
node scripts/apply-migrations.js 37_subscriptions
```

For production, add the production **postgres/admin** connection string as
`DATABASE_URL` in the git-ignored `genie-backend/.env.prod-db`, then run:

```sh
node scripts/apply-migrations.js 37_subscriptions --prod
```

The existing `*_DATABASE_URL` service logins in `.env.prod-db` cannot alter
tables. `--prod` reads only that file's `DATABASE_URL`; a missing file or URL
stops the command without falling back to staging or shell credentials.
Multiple migration names still run in the order supplied, in one transaction.

Deleting an account deletes its rows in every schema through the foreign keys
(`ON DELETE CASCADE`); that runs as the table owner, so no extra grants are needed.

### The cross-schema reads (what to replace before splitting databases)

- `account.users` is read by property (owner names on listings, the feed, people search,
  the admin check), chat (partners, keys, presence) and notification (skipping deactivated
  accounts, the admin check).
- chat writes its key and "last seen" columns on `account.users`.
- 40-odd foreign keys point at `account.users` and `listing.properties` from other schemas.

Before a schema moves to another instance, these must become API calls or a copied read
model, and its foreign keys to other schemas must be dropped.

## Giving a login a password

Passwords are secrets: never in a migration or in git. As `postgres`:

```sql
ALTER ROLE chat_service PASSWORD '<random secret>';
```

(`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` makes one
that needs no escaping in a URL.) On Supabase's pooler the user name is
`<role>.<project ref>`:

```
postgresql://chat_service.<project ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Set that as the service's `DATABASE_URL` (Railway), or as `CHAT_DATABASE_URL` etc. in `.env`
for docker compose. A service without its own login keeps working on the `postgres` URL.

## A new database

`prisma/prod_schema.sql` builds all of the above (schemas, tables, logins, grants, keywords,
storage buckets) on an empty database in one transaction. Then set the six passwords.
