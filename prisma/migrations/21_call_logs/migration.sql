-- One row per voice call, so every call can be traced: who called whom,
-- whether it was answered, how it ended. The call itself (audio) goes
-- straight between the two phones and is never stored.
CREATE TABLE IF NOT EXISTS "call_logs" (
  "id"          UUID           NOT NULL,
  "caller_id"   UUID           NOT NULL,
  "callee_id"   UUID           NOT NULL,
  "status"      TEXT           NOT NULL DEFAULT 'ringing',
  "end_reason"  TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "answered_at" TIMESTAMPTZ(6),
  "ended_at"    TIMESTAMPTZ(6),
  CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_logs_caller_id_fkey" FOREIGN KEY ("caller_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_logs_callee_id_fkey" FOREIGN KEY ("callee_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_logs_status_check" CHECK ("status" IN ('ringing', 'active', 'ended')),
  CONSTRAINT "call_logs_end_reason_check" CHECK (
    "end_reason" IS NULL
    OR "end_reason" IN ('ended', 'declined', 'missed', 'cancelled', 'disconnected')
  )
);

CREATE INDEX IF NOT EXISTS "call_logs_caller_id_created_at_idx" ON "call_logs" ("caller_id", "created_at");
CREATE INDEX IF NOT EXISTS "call_logs_callee_id_created_at_idx" ON "call_logs" ("callee_id", "created_at");

-- Like every table here: closed to Supabase's public REST roles (see 5_).
ALTER TABLE "call_logs" ENABLE ROW LEVEL SECURITY;
