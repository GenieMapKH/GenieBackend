-- The map shows the newest 500 published listings inside the area. Where an
-- area holds many (a city, the whole country), Postgres used to read every
-- listing in it and sort them all; with this it reads published listings
-- newest first and stops at 500. Areas with few listings keep using the
-- location indexes. Measured on 200 000 listings: a city 63 ms -> 4 ms, the
-- whole country 120 ms -> 3 ms; sparse areas unchanged (0.1 to 5 ms).
-- (A PostGIS GiST index was measured too and was slower: not adopted.)
-- An index only: safe before or after any code.
CREATE INDEX IF NOT EXISTS "properties_active_newest_idx"
  ON "properties" ("created_at" DESC)
  WHERE "status" = 'Active';
