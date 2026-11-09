ALTER TABLE account.users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
-- Serialize token creation with bans: a concurrent sign-in cannot escape session revocation.
CREATE FUNCTION account.reject_banned_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blocked boolean;
BEGIN
  IF NOT NEW.revoked THEN
    SELECT banned_at IS NOT NULL INTO blocked FROM account.users WHERE id = NEW.user_id FOR SHARE;
    IF blocked THEN RAISE EXCEPTION 'Account is banned' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refresh_tokens_reject_banned BEFORE INSERT OR UPDATE OF revoked ON account.refresh_tokens
FOR EACH ROW EXECUTE FUNCTION account.reject_banned_session();
CREATE TABLE account.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON account.moderation_actions(target_id, created_at);
ALTER TABLE account.moderation_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account.moderation_actions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON account.moderation_actions TO user_service;
