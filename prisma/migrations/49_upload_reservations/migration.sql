CREATE TABLE IF NOT EXISTS account.upload_budgets (
  user_id uuid NOT NULL, kind text NOT NULL, day date NOT NULL,
  issued_bytes integer NOT NULL CHECK (issued_bytes >= 0),
  issued_count integer NOT NULL CHECK (issued_count >= 0),
  PRIMARY KEY (user_id, kind, day)
);
CREATE INDEX IF NOT EXISTS upload_budgets_day_idx ON account.upload_budgets(day);
ALTER TABLE account.upload_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account.upload_budgets FROM PUBLIC;
GRANT USAGE ON SCHEMA account TO user_service, property_service, chat_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON account.upload_budgets TO user_service, property_service, chat_service;

CREATE TABLE IF NOT EXISTS listing.property_upload_reservations (
  path text PRIMARY KEY, user_id uuid NOT NULL, property_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  confirmed_at timestamptz, cleaned_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS property_upload_reservations_user_idx ON listing.property_upload_reservations(user_id, confirmed_at, cleaned_at);
CREATE INDEX IF NOT EXISTS property_upload_reservations_property_idx ON listing.property_upload_reservations(property_id, confirmed_at, cleaned_at);
CREATE INDEX IF NOT EXISTS property_upload_reservations_expiry_idx ON listing.property_upload_reservations(expires_at, cleaned_at);
ALTER TABLE listing.property_upload_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON listing.property_upload_reservations FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON listing.property_upload_reservations TO property_service;
