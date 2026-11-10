-- Push notifications (notification service).
--
-- push_devices: where to reach each signed-in device. A device's token is
-- tied to the session it registered from, so signing that device out (or
-- signing in as someone else on it) stops its pushes at once.
CREATE TABLE IF NOT EXISTS "push_devices" (
  "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID           NOT NULL,
  "session_id" UUID,
  "token"      TEXT           NOT NULL,
  "platform"   TEXT           NOT NULL,
  "locale"     TEXT           NOT NULL DEFAULT 'en',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "push_devices_platform_check" CHECK ("platform" IN ('android', 'ios', 'web')),
  CONSTRAINT "push_devices_locale_check" CHECK ("locale" IN ('en', 'km'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_devices_token_key" ON "push_devices" ("token");
CREATE INDEX IF NOT EXISTS "push_devices_user_id_idx" ON "push_devices" ("user_id");
CREATE INDEX IF NOT EXISTS "push_devices_session_id_idx" ON "push_devices" ("session_id");

-- What each user wants to be told about. No row means the defaults. Security
-- alerts and calls are not optional, so they have no column.
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id"       UUID           NOT NULL,
  "chat_messages" BOOLEAN        NOT NULL DEFAULT true,
  "promotions"    BOOLEAN        NOT NULL DEFAULT true,
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Promotions an admin sent to everyone who allows them. The id can be chosen
-- by the sender, so sending the same request twice sends it once.
CREATE TABLE IF NOT EXISTS "promotions" (
  "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
  "created_by"   UUID,
  "title"        TEXT           NOT NULL,
  "body"         TEXT           NOT NULL,
  "title_km"     TEXT,
  "body_km"      TEXT,
  "property_id"  UUID,
  "url"          TEXT,
  "image_url"    TEXT,
  "status"       TEXT           NOT NULL DEFAULT 'queued',
  "sent_count"   INTEGER        NOT NULL DEFAULT 0,
  "failed_count" INTEGER        NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "started_at"   TIMESTAMPTZ(6),
  "finished_at"  TIMESTAMPTZ(6),
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotions_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "promotions_property_id_fkey" FOREIGN KEY ("property_id")
    REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "promotions_status_check" CHECK ("status" IN ('queued', 'sending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS "promotions_created_at_idx" ON "promotions" ("created_at");

-- Like every table here: closed to Supabase's public REST roles (see 5_).
ALTER TABLE "push_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;
