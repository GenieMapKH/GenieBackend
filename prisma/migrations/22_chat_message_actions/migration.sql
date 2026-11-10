-- Replying to, editing and deleting single chat messages.

-- The message a reply quotes. Deleting that message (for everyone) unlinks
-- the reply, so nothing of the deleted message is shown any more.
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "reply_to_id" UUID
    CONSTRAINT "messages_reply_to_id_fkey" REFERENCES "messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- When the sender last changed the text (allowed for an hour after sending).
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "edited_at" TIMESTAMPTZ(6);

-- Unlinking replies on delete looks them up by this column.
CREATE INDEX IF NOT EXISTS "messages_reply_to_id_idx" ON "messages" ("reply_to_id");

-- "Delete for me" of one message: hidden from that person only.
CREATE TABLE IF NOT EXISTS "chat_hidden_messages" (
  "user_id"    UUID           NOT NULL,
  "message_id" UUID           NOT NULL,
  "hidden_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "chat_hidden_messages_pkey" PRIMARY KEY ("user_id", "message_id"),
  CONSTRAINT "chat_hidden_messages_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_hidden_messages_message_id_fkey" FOREIGN KEY ("message_id")
    REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "chat_hidden_messages_message_id_idx"
  ON "chat_hidden_messages" ("message_id");

-- Like every table here: closed to Supabase's public REST roles (see 5_).
ALTER TABLE "chat_hidden_messages" ENABLE ROW LEVEL SECURITY;
