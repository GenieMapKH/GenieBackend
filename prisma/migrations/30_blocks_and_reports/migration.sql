-- Who has blocked whom. One row per pair, so blocking twice changes nothing.
-- Nobody can block themselves. Deleting either account deletes the row.
CREATE TABLE IF NOT EXISTS "user_blocks" (
  "blocker_id" UUID           NOT NULL,
  "blocked_id" UUID           NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id"),
  CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_blocks_not_self_check" CHECK ("blocker_id" <> "blocked_id")
);

-- The primary key answers "whom did X block"; this answers "who blocked X".
CREATE INDEX IF NOT EXISTS "user_blocks_blocked_id_idx" ON "user_blocks" ("blocked_id");

-- A report of a listing or an account, for an admin to review. Exactly one
-- target is set. A report goes with its target: a listing or account that is
-- deleted needs no review.
CREATE TABLE IF NOT EXISTS "reports" (
  "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
  "reporter_id"      UUID           NOT NULL,
  "property_id"      UUID,
  "reported_user_id" UUID,
  "reason"           TEXT           NOT NULL,
  "details"          TEXT,
  "status"           TEXT           NOT NULL DEFAULT 'open',
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "reviewed_at"      TIMESTAMPTZ(6),
  "reviewed_by"      UUID,
  "review_note"      TEXT,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reports_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reports_one_target_check"
    CHECK (("property_id" IS NULL) <> ("reported_user_id" IS NULL)),
  CONSTRAINT "reports_not_self_check" CHECK ("reporter_id" <> "reported_user_id"),
  CONSTRAINT "reports_reason_check" CHECK ("reason" IN (
    'spam', 'scam', 'misleading', 'inappropriate', 'duplicate', 'unavailable',
    'harassment', 'impersonation', 'other')),
  CONSTRAINT "reports_status_check" CHECK ("status" IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT "reports_details_length_check" CHECK (char_length("details") <= 1000)
);

-- One open report per person and target: reporting again changes nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "reports_open_listing_key"
  ON "reports" ("reporter_id", "property_id")
  WHERE "status" = 'open' AND "property_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "reports_open_user_key"
  ON "reports" ("reporter_id", "reported_user_id")
  WHERE "status" = 'open' AND "reported_user_id" IS NOT NULL;

-- The review queue, oldest first, by status.
CREATE INDEX IF NOT EXISTS "reports_status_created_at_idx" ON "reports" ("status", "created_at");

-- Like every table here: closed to Supabase's public REST roles (see 5_).
ALTER TABLE "user_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
