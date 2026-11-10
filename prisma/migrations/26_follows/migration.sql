-- Who follows whom. One row per pair, so following twice changes nothing.
-- Nobody can follow themselves. Deleting either account deletes the row.
CREATE TABLE IF NOT EXISTS "follows" (
  "follower_id"  UUID           NOT NULL,
  "following_id" UUID           NOT NULL,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "follows_pkey" PRIMARY KEY ("follower_id", "following_id"),
  CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "follows_following_id_fkey" FOREIGN KEY ("following_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "follows_not_self_check" CHECK ("follower_id" <> "following_id")
);

-- The primary key answers "who does X follow"; this answers "who follows X"
-- (the follower count).
CREATE INDEX IF NOT EXISTS "follows_following_id_idx" ON "follows" ("following_id");

-- Like every table here: closed to Supabase's public REST roles (see 5_).
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;
