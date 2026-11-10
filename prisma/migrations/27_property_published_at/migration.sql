-- When a listing last went live (Draft, Expired or Sold -> Active). The feed
-- is ordered by it: `created_at` is when the owner started the draft, which
-- can be months before anyone could see the listing.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ(6);

-- Listings published before this column existed: their creation time is the
-- best date known. Cut to milliseconds, the precision of the feed's cursor
-- (and of every date the backend writes), so a cursor never skips a listing.
UPDATE "properties"
   SET "published_at" = date_trunc('milliseconds', "created_at")
 WHERE "published_at" IS NULL
   AND "status" IN ('Active', 'Sold', 'Expired');

-- The feed: the newest published listings of up to 500 owners, a page at a
-- time from a (published_at, id) cursor.
CREATE INDEX IF NOT EXISTS "properties_active_owner_published_idx"
  ON "properties" ("user_id", "published_at" DESC, "id")
  WHERE "status" = 'Active';
