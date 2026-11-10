-- 36: two logins per service, so database passwords can rotate without downtime.
--
-- Each service connects as one of <service>_service_1 / <service>_service_2.
-- Once a month scripts/secret-rotation gives the login NOT in use a new
-- password and switches the service to it. The login it leaves keeps working
-- until the next rotation, so a service still running on it is never cut off.
-- See docs/SECRET_ROTATION.md.
--
-- Both are members of the service's role from migration 34 and inherit its
-- grants, so nothing about what a service may touch changes. BYPASSRLS is a
-- role attribute, not inherited, so each login gets it itself (see 34).
--
-- No passwords here: the logins cannot sign in until
-- scripts/secret-rotation/bootstrap.js gives them one. After that each login
-- changes only its own password; no stored credential can change another's.
--
-- Safe to run twice.

DO $$
DECLARE
  service text;
  n int;
  login text;
BEGIN
  FOREACH service IN ARRAY ARRAY[
    'authentication', 'user', 'property', 'chat', 'payment', 'notification'
  ] LOOP
    FOR n IN 1..2 LOOP
      login := format('%s_service_%s', service, n);
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = login) THEN
        EXECUTE format('CREATE ROLE %I LOGIN BYPASSRLS INHERIT', login);
      END IF;
      EXECUTE format('GRANT %I TO %I', service || '_service', login);
    END LOOP;
  END LOOP;
END $$;
