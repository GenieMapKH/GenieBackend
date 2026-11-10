-- A map search someone saved: an area and the map filter. When a listing
-- goes live that it would show, its owner is told (if `alerts`). The filter
-- columns mean what the map filter's do (`map-filter.ts`); an empty list or
-- a null bound means any.
CREATE TABLE IF NOT EXISTS "saved_searches" (
  "id"             UUID             NOT NULL DEFAULT gen_random_uuid(),
  "user_id"        UUID             NOT NULL,
  "name"           TEXT             NOT NULL,
  "min_lat"        DOUBLE PRECISION NOT NULL,
  "max_lat"        DOUBLE PRECISION NOT NULL,
  "min_lng"        DOUBLE PRECISION NOT NULL,
  "max_lng"        DOUBLE PRECISION NOT NULL,
  "property_type"  TEXT,
  "listing_types"  TEXT[]           NOT NULL DEFAULT '{}',
  "min_price"      DECIMAL(12, 2),
  "max_price"      DECIMAL(12, 2),
  "min_size"       DECIMAL(12, 2),
  "max_size"       DECIMAL(12, 2),
  "keywords"       TEXT[]           NOT NULL DEFAULT '{}',
  "alerts"         BOOLEAN          NOT NULL DEFAULT true,
  "created_at"     TIMESTAMPTZ(6)   NOT NULL DEFAULT now(),
  CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saved_searches_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "saved_searches_name_check" CHECK (char_length("name") BETWEEN 1 AND 60),
  CONSTRAINT "saved_searches_area_check"
    CHECK ("min_lat" <= "max_lat" AND "min_lng" <= "max_lng"),
  CONSTRAINT "saved_searches_price_check"
    CHECK ("min_price" IS NULL OR "max_price" IS NULL OR "min_price" <= "max_price"),
  CONSTRAINT "saved_searches_size_check"
    CHECK ("min_size" IS NULL OR "max_size" IS NULL OR "min_size" <= "max_size")
);

-- A person's own list, newest first.
CREATE INDEX IF NOT EXISTS "saved_searches_user_id_created_at_idx"
  ON "saved_searches" ("user_id", "created_at" DESC);

-- A listing going live looks for the alerting searches whose area holds it.
CREATE INDEX IF NOT EXISTS "saved_searches_alert_area_idx"
  ON "saved_searches" ("min_lat", "max_lat") WHERE "alerts";

-- Which listing each search already told its owner about, so a listing that
-- is unpublished and published again does not alert twice.
CREATE TABLE IF NOT EXISTS "saved_search_matches" (
  "saved_search_id" UUID           NOT NULL,
  "property_id"     UUID           NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "saved_search_matches_pkey" PRIMARY KEY ("saved_search_id", "property_id"),
  CONSTRAINT "saved_search_matches_saved_search_id_fkey" FOREIGN KEY ("saved_search_id")
    REFERENCES "saved_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "saved_search_matches_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Saved-search alerts can be turned off like the other pushes.
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "saved_search_alerts" BOOLEAN NOT NULL DEFAULT true;

-- Like every table here: closed to Supabase's public REST roles (see 5_).
ALTER TABLE "saved_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_search_matches" ENABLE ROW LEVEL SECURITY;
