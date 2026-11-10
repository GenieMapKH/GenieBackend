-- 35: the keys the authentication service signs tokens with.
--
-- The service creates, rotates and deletes these rows itself
-- (authentication/src/auth/signing-keys). Other services never read this
-- table: they fetch the public halves from GET /v1/auth/.well-known/jwks.json.
--
--   kid                    the key's id, written into each token's header
--   public_key             PEM; published while tokens it signed may be in use
--   private_key_encrypted  AES-256-GCM under JWT_KEY_ENCRYPTION_KEY, so a
--                          database dump or backup alone cannot sign tokens.
--                          NULL for the imported pre-rotation key, which only verifies.
--   activates_at           when it starts signing (published before that)
--   retired_at             when its successor took over
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS account.jwt_signing_keys (
  kid                   text        PRIMARY KEY,
  public_key            text        NOT NULL,
  private_key_encrypted text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  activates_at          timestamptz NOT NULL,
  retired_at            timestamptz
);

-- Same as every table (migration 24): row level security with no policies
-- keeps Supabase's public API keys out. The service login bypasses it.
ALTER TABLE account.jwt_signing_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON account.jwt_signing_keys FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON account.jwt_signing_keys FROM anon, authenticated, service_role;
  END IF;
END $$;

-- Only authentication: user_service shares the schema but must not see keys.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authentication_service') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON account.jwt_signing_keys TO authentication_service;
  END IF;
END $$;
