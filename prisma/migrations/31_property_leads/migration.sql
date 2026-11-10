-- Someone who called or opened a chat about a listing from its page: what
-- the owner counts as a lead. One row per person, listing and channel, so
-- tapping again counts nothing more. Deleting the listing or the account
-- deletes the row.
CREATE TABLE IF NOT EXISTS "property_leads" (
  "property_id" UUID           NOT NULL,
  "user_id"     UUID           NOT NULL,
  "channel"     TEXT           NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "property_leads_pkey" PRIMARY KEY ("property_id", "user_id", "channel"),
  CONSTRAINT "property_leads_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "property_leads_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "property_leads_channel_check" CHECK ("channel" IN ('call', 'chat'))
);

-- The owner's insights read a listing's leads by day.
CREATE INDEX IF NOT EXISTS "property_leads_property_id_created_at_idx"
  ON "property_leads" ("property_id", "created_at");

-- The same for views and saves, read by day for the owner's insights.
CREATE INDEX IF NOT EXISTS "property_views_property_id_created_at_idx"
  ON "property_views" ("property_id", "created_at");
CREATE INDEX IF NOT EXISTS "property_favorites_property_id_created_at_idx"
  ON "property_favorites" ("property_id", "created_at");

-- Like every table here: closed to Supabase's public REST roles (see 5_).
ALTER TABLE "property_leads" ENABLE ROW LEVEL SECURITY;
