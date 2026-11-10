#!/usr/bin/env bash
# Restores a backup made by scripts/backup-database.sh into TARGET_DATABASE_URL.
#
#   TARGET_DATABASE_URL=postgresql://... scripts/restore-database.sh <backup.dump | backup.dump.age> [age-identity-file]
#
# An encrypted backup (.age) needs the private key it was made for (see
# docs/BACKUPS.md). The target must have no app tables yet: restoring
# over live data is refused, so a typo in the URL cannot wipe a database.
#
# Ends by listing every table with its row count; any error stops it.
set -euo pipefail

# Where the app keeps its tables (migration 34).
app_schemas="'public', 'account', 'listing', 'chat', 'payment', 'notification'"
service_logins="$(dirname "$0")/../prisma/migrations/34_service_schemas/migration.sql"

backup="${1:?usage: TARGET_DATABASE_URL=... $0 <backup.dump|backup.dump.age> [age-identity-file]}"
identity="${2:-}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is not set}"

psql_target() { psql "$TARGET_DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 "$@"; }

existing=$(psql_target -c "SELECT count(*) FROM pg_tables WHERE schemaname IN ($app_schemas)")
if [ "$existing" != "0" ]; then
  echo "Refusing: the target already has $existing app tables. Restore into an empty database." >&2
  exit 1
fi

dump="$backup"
if [[ "$backup" == *.age ]]; then
  [ -n "$identity" ] || { echo "An encrypted backup needs the age identity (private key) file." >&2; exit 1; }
  dump="$(mktemp)"
  # The decrypted copy never outlives this script.
  trap 'rm -f "$dump"' EXIT
  age --decrypt --identity "$identity" --output "$dump" "$backup"
fi

# Extensions are not part of a schema dump. The trigram search indexes need
# pg_trgm, which lives in "public" on the live database.
psql_target -c "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"

# Every database already has a "public" schema: everything in the dump but
# the statements that create or describe that schema itself.
contents="$(mktemp)"
trap 'rm -f "$contents"; [ "$dump" = "$backup" ] || rm -f "$dump"' EXIT
pg_restore --list "$dump" | grep -v -E ' (SCHEMA|COMMENT) - (public|SCHEMA public) ' > "$contents"

pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --no-privileges --exit-on-error \
  --use-list="$contents" "$dump"

# The dump has no logins or grants: migration 34 makes the service logins
# (without passwords) and gives each its access. It moves nothing here.
psql_target -f "$service_logins"

echo "Restored. Rows per table:"
psql_target -c "
  SELECT format('%s.%s: %s', table_schema, table_name,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text)
  FROM information_schema.tables
  WHERE table_schema IN ($app_schemas) AND table_type = 'BASE TABLE'
  ORDER BY table_schema, table_name"
