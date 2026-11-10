# Scaling work: status

Updated 2026-10-20. Covers both repositories: `tilomnov-backend` (this one) and the Flutter app `tilomnov`.

## Status

| # | Slice | Status |
|---|---|---|
| 0 | Performance fixes from the scan | **Done** |
| 1 | Nightly database backups | **Done**; needs your one-time setup |
| 2 | Pagination (saved listings, own listings, conversations) | **Done**, backend and app |
| 3 | Pause hidden tabs | **Done** (app) |
| 4 | Search with Meilisearch | **Done**; works without it until you add the engine on Railway |
| 5 | PostGIS for the map | **Measured, not adopted**; a plain index won instead (migration 25) |
| 6 | Read replica routing | **Done**; inert until `DATABASE_READ_URL` is set (needs a paid plan) |
| - | ML Kit unbundled | **Dropped** by decision |

Nothing is pushed.

## Branches and merge order

Each branch builds on the one before it on the same line.

| Repo | Branch | Holds |
|---|---|---|
| backend | `perf/scan-fixes` | Performance fixes, migration 23 |
| backend | `feat/database-backups` (from `perf/scan-fixes`) | Backups, `docs/BACKUPS.md`, migration 24 |
| backend | `feat/pagination` (from `perf/scan-fixes`) | Paged endpoints |
| backend | `feat/meilisearch-search` (from `feat/pagination`) | Search engine, `ListingChanges` |
| backend | `perf/map-newest-first` (from `feat/meilisearch-search`) | Migration 25 |
| backend | `feat/read-replica-routing` (from `perf/map-newest-first`) | `ReadPrisma`, this document |
| app | `perf/scan-fixes` | App performance fixes |
| app | `feat/pagination` (from `perf/scan-fixes`) | Paged lists, hearts from ids, unread total |
| app | `feat/pause-hidden-tabs` (from `feat/pagination`) | Hidden tabs stop redrawing |

Merge order: backend `perf/scan-fixes`, then `feat/database-backups`, then `feat/read-replica-routing` (it
contains pagination, search and migration 25). App: `feat/pause-hidden-tabs` (it contains the rest). Ship the
backend before the app: the paged endpoints answer older app builds exactly as before, but the new app needs them.

## What only you can do

1. **Backups**: make an age key, add the `BACKUP_DATABASE_URL` secret and the `BACKUP_AGE_RECIPIENT` variable in
   GitHub, run the "Database backup" workflow once (`docs/BACKUPS.md`). Until then nothing is backed up.
2. **Migrations** (indexes and security only, safe before or after the code):
   `node scripts/apply-migrations.js 23_property_likes_index 24_row_level_security_everywhere 25_map_newest_first_index`
3. **Deploy**: `npm install` and `npx prisma generate` at the root, then rebuild **every** service (the shared
   database module changed).
4. **Search engine** (optional, any time): add Meilisearch on Railway and set `MEILISEARCH_URL` and
   `MEILISEARCH_API_KEY` on the property service (`docs/RAILWAY.md`, "Search engine"). The index fills itself on
   the next start.
5. **Try the app on a phone** against staging: My Properties and Saved loading more as you scroll, the tab counts,
   hearts, the chat list and its unread badge, and switching tabs.

## Decisions made while finishing (say if you want any changed)

- **Khmer search**: Meilisearch v1.54.3 splits Khmer into words (tested), but does not find the end of a word
  inside a longer one (ពេញ in ភ្នំពេញ), which the old substring search did. So a short answer to Khmer text is
  topped up from the database; Latin text uses the engine alone (with typo tolerance from 5 letters).
- **Search results are read back from the database by id**, so the response is unchanged and a stale index can
  never show a draft, a deleted listing or a hidden account. Engine down or slower than 1.5 s: the database answers.
- **Index sync**: every listing change goes through `ListingChanges`; a failed index update is logged and never
  fails the write. The index is rebuilt nightly at 03:00 Cambodia time, which repairs anything missed.
- **PostGIS**: on 200 000 listings a GiST index was slower at five of six zoom levels. The real cost was sorting
  every listing in a busy area to find the newest 500; a partial index on `created_at` fixes that (a city 63 ms to
  4 ms, the whole country 120 ms to 3 ms). Nearby-by-distance and boundary overlap were not built: they were
  optional and depended on adopting PostGIS.
- **Replica**: only the property service's public reads use it. The user service's own reads stay on the primary.
- **Hidden tabs**: My Properties, Saved and the chat list stop watching their data while hidden and redraw once
  when shown; the map redraws its markers once uncovered instead of while a page covers it.

## Not mine, left as found

The backend working tree has uncommitted reformatting in `api-gateway/src/rate-limit.middleware.ts`,
`redis-connection.ts` and `service-routes.spec.ts` (line wrapping only, likely an editor's format on save). Keep or
discard it as you prefer.

## Testing without Docker or the hosted database

- **Postgres 17** (portable Windows binaries) on a spare port; apply `prisma/migrations/*/migration.sql` in numeric
  order with `psql`. For PostGIS, add the `postgis-bundle-pg17` zip from download.osgeo.org.
- **Meilisearch**: the single binary from its GitHub releases. The live engine tests run with
  `MEILISEARCH_TEST_URL` and `MEILISEARCH_TEST_KEY` set (they replace its indexes; never a shared engine).
- **Running a service locally**: set every key of `.env` in the environment first (dotenv fills only missing ones),
  so nothing reaches the hosted database; send `x-user-id` as the gateway would.
- **Hosted database**: read-only checks only. Never write to it from a session.
