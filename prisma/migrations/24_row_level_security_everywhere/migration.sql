-- Row level security on the tables migrations 0-2 created without it.
--
-- The live database already has it on every table (switched on when the
-- tables were first made in Supabase), so this changes nothing there. But a
-- database rebuilt from these migrations alone, say a new Supabase project
-- after a disaster, would otherwise serve users, refresh tokens and payments
-- to anyone with the public anon key through Supabase's REST API. See 5_ for
-- why no policy is needed: the backend bypasses row level security.
ALTER TABLE IF EXISTS "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "guest_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "payment_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "property_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "property_favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "property_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "property_likes" ENABLE ROW LEVEL SECURITY;
