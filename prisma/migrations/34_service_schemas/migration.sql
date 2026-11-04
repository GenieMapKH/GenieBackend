-- 34: one schema per service, and one database login per service.
--
-- Every table moves out of "public" into the schema of the service that owns
-- it. ALTER TABLE ... SET SCHEMA only renames: rows, indexes, constraints,
-- foreign keys and row level security move with the table, instantly.
--
--   account       authentication + user   users, refresh_tokens, password_reset_otps,
--                                         follows, user_blocks, reports
--   listing       property                properties and everything about listings,
--                                         keywords, saved and past searches, guest sessions
--   chat          chat                    messages, chat_*, call_logs
--   payment       payment                 payment_transactions
--   notification  notification            push_devices, notification_preferences, promotions
--
-- Then each service gets its own login role that can only reach its own
-- tables, plus the few reads of account.users the code really does
-- (docs/DATABASE_SCHEMAS.md). The roles have no password here: passwords are
-- secrets and are set outside source control (ALTER ROLE ... PASSWORD).
-- Until a service is given its own login it keeps working on the "postgres"
-- login, which owns every table.
--
-- Safe to run twice. Deploy together with the backend that reads these
-- schemas: older code looks for its tables in "public" and fails once they move.

CREATE SCHEMA IF NOT EXISTS account;
CREATE SCHEMA IF NOT EXISTS listing;
CREATE SCHEMA IF NOT EXISTS chat;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS notification;

DO $$
DECLARE
  move record;
BEGIN
  FOR move IN
    SELECT * FROM (VALUES
      ('users', 'account'),
      ('refresh_tokens', 'account'),
      ('password_reset_otps', 'account'),
      ('follows', 'account'),
      ('user_blocks', 'account'),
      ('reports', 'account'),
      ('properties', 'listing'),
      ('property_images', 'listing'),
      ('property_likes', 'listing'),
      ('property_favorites', 'listing'),
      ('property_views', 'listing'),
      ('property_contacts', 'listing'),
      ('property_leads', 'listing'),
      ('property_nearby_places', 'listing'),
      ('property_keywords', 'listing'),
      ('keywords', 'listing'),
      ('saved_searches', 'listing'),
      ('saved_search_matches', 'listing'),
      ('search_history', 'listing'),
      ('guest_sessions', 'listing'),
      ('messages', 'chat'),
      ('chat_key_backups', 'chat'),
      ('chat_conversation_states', 'chat'),
      ('chat_hidden_messages', 'chat'),
      ('call_logs', 'chat'),
      ('payment_transactions', 'payment'),
      ('push_devices', 'notification'),
      ('notification_preferences', 'notification'),
      ('promotions', 'notification')
    ) AS t(table_name, schema_name)
  LOOP
    IF to_regclass(format('public.%I', move.table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', move.table_name, move.schema_name);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Service logins. BYPASSRLS because every table has row level security on
-- with no policies (migration 24): that keeps Supabase's public API keys out,
-- and must not keep the services out.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'authentication_service', 'user_service', 'property_service',
    'chat_service', 'payment_service', 'notification_service'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN BYPASSRLS', role_name);
    END IF;
  END LOOP;
END $$;

-- Nobody reaches a service schema unless granted below. Supabase's API roles
-- kept their old grants on the moved tables: take them away too.
REVOKE ALL ON SCHEMA account, listing, chat, payment, notification FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA account, listing, chat, payment, notification
      FROM anon, authenticated, service_role;
  END IF;
END $$;

-- pg_trgm (search indexes) lives in "public".
GRANT USAGE ON SCHEMA public TO
  authentication_service, user_service, property_service,
  chat_service, payment_service, notification_service;

-- account: shared by authentication (sign-in) and user (profiles, follows,
-- blocks, reports). Only authentication creates or deletes an account.
GRANT USAGE ON SCHEMA account TO
  authentication_service, user_service, property_service, chat_service, notification_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON account.users, account.refresh_tokens, account.password_reset_otps
  TO authentication_service;
GRANT SELECT, UPDATE ON account.users TO user_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON account.follows, account.user_blocks, account.reports
  TO user_service;
-- Owners' names and photos on listings, the admin check, and skipping
-- deactivated accounts.
GRANT SELECT ON account.users TO property_service, chat_service, notification_service;
-- The chat keys and "last seen" still live on the users row.
GRANT UPDATE (identity_public_key, backup_blob, backup_salt, backup_nonce, last_seen_at)
  ON account.users TO chat_service;

-- The single-owner schemas: everything in them, now and in later migrations.
GRANT USAGE ON SCHEMA listing TO property_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA listing TO property_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA listing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO property_service;

GRANT USAGE ON SCHEMA chat TO chat_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA chat TO chat_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA chat
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chat_service;

GRANT USAGE ON SCHEMA payment TO payment_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payment TO payment_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO payment_service;

GRANT USAGE ON SCHEMA notification TO notification_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO notification_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notification_service;
