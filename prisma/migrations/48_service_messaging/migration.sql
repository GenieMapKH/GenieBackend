-- 48: durable service outboxes and delivery receipts. Safe to apply twice.

CREATE TABLE IF NOT EXISTS account.service_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  dedup_key text,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_outbox_dedup UNIQUE (service, dedup_key)
);
CREATE INDEX IF NOT EXISTS service_outbox_pending ON account.service_outbox (service, published_at, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS account.service_message_receipts (
  service text NOT NULL,
  event_id uuid NOT NULL,
  step text NOT NULL DEFAULT '',
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, event_id, step)
);
CREATE INDEX IF NOT EXISTS service_message_receipts_processed ON account.service_message_receipts (processed_at);
ALTER TABLE account.service_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE account.service_message_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account.service_outbox, account.service_message_receipts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON account.service_outbox, account.service_message_receipts TO authentication_service, user_service;

CREATE TABLE IF NOT EXISTS listing.service_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  dedup_key text,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_outbox_dedup UNIQUE (service, dedup_key)
);
CREATE INDEX IF NOT EXISTS service_outbox_pending ON listing.service_outbox (service, published_at, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS listing.service_message_receipts (
  service text NOT NULL,
  event_id uuid NOT NULL,
  step text NOT NULL DEFAULT '',
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, event_id, step)
);
CREATE INDEX IF NOT EXISTS service_message_receipts_processed ON listing.service_message_receipts (processed_at);
ALTER TABLE listing.service_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing.service_message_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON listing.service_outbox, listing.service_message_receipts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON listing.service_outbox, listing.service_message_receipts TO property_service;

CREATE TABLE IF NOT EXISTS chat.service_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  dedup_key text,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_outbox_dedup UNIQUE (service, dedup_key)
);
CREATE INDEX IF NOT EXISTS service_outbox_pending ON chat.service_outbox (service, published_at, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS chat.service_message_receipts (
  service text NOT NULL,
  event_id uuid NOT NULL,
  step text NOT NULL DEFAULT '',
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, event_id, step)
);
CREATE INDEX IF NOT EXISTS service_message_receipts_processed ON chat.service_message_receipts (processed_at);
ALTER TABLE chat.service_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.service_message_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chat.service_outbox, chat.service_message_receipts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat.service_outbox, chat.service_message_receipts TO chat_service;

CREATE TABLE IF NOT EXISTS payment.service_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  dedup_key text,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_outbox_dedup UNIQUE (service, dedup_key)
);
CREATE INDEX IF NOT EXISTS service_outbox_pending ON payment.service_outbox (service, published_at, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS payment.service_message_receipts (
  service text NOT NULL,
  event_id uuid NOT NULL,
  step text NOT NULL DEFAULT '',
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, event_id, step)
);
CREATE INDEX IF NOT EXISTS service_message_receipts_processed ON payment.service_message_receipts (processed_at);
ALTER TABLE payment.service_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment.service_message_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment.service_outbox, payment.service_message_receipts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment.service_outbox, payment.service_message_receipts TO payment_service;

CREATE TABLE IF NOT EXISTS notification.service_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  dedup_key text,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_outbox_dedup UNIQUE (service, dedup_key)
);
CREATE INDEX IF NOT EXISTS service_outbox_pending ON notification.service_outbox (service, published_at, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS notification.service_message_receipts (
  service text NOT NULL,
  event_id uuid NOT NULL,
  step text NOT NULL DEFAULT '',
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, event_id, step)
);
CREATE INDEX IF NOT EXISTS service_message_receipts_processed ON notification.service_message_receipts (processed_at);
ALTER TABLE notification.service_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.service_message_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification.service_outbox, notification.service_message_receipts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification.service_outbox, notification.service_message_receipts TO notification_service;

DO $$
DECLARE schema_name text; role_name text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['account', 'listing', 'chat', 'payment', 'notification'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON %I.service_outbox, %I.service_message_receipts FROM %I', schema_name, schema_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
