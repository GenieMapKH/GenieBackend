ALTER TABLE account.users
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

-- Legacy contacts have no ownership evidence and must not be silently trusted.
CREATE TABLE IF NOT EXISTS account.email_verifications (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE account.email_verifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS email_verifications_expires_at_idx ON account.email_verifications(expires_at);
REVOKE ALL ON account.email_verifications FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON account.email_verifications TO authentication_service;
