-- When the owner's followers were told about this listing: once, the first
-- time it went on the map, so publishing it again tells nobody twice.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "followers_notified_at" TIMESTAMPTZ(6);

-- The last time the price a buyer pays (after any discount) fell on a live
-- listing, and what it was before. Shown as "price dropped" for a while.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "price_dropped_at" TIMESTAMPTZ(6);
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "previous_price" DECIMAL(12, 2);

-- When the people who saved it were last told of a price drop: at most once
-- a day, so a row of small cuts is not a row of pushes.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "price_drop_notified_at" TIMESTAMPTZ(6);

-- The pushes these drive can be turned off like the others.
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "followed_listings" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "saved_listing_updates" BOOLEAN NOT NULL DEFAULT true;
