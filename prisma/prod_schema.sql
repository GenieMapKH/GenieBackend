-- =====================================================================
-- Genie: the whole production database, for a NEW, EMPTY Postgres
-- (a fresh Supabase project). Generated 2026-11-04 from the tested end state
-- of prisma/migrations 0_init .. 34_service_schemas, in the exact form the
-- staging database has (column order, constraint names).
--
-- Creates:
--   * 5 schemas, one per service: account, listing, chat, payment, notification
--     (29 tables, every column, default, constraint, index, foreign key and
--     row level security switch), plus public._prisma_migrations
--   * 6 service logins (no passwords; see below) and exactly the access each
--     service needs (docs/DATABASE_SCHEMAS.md)
--   * reference data: the 10 listing keywords
--   * the 3 storage buckets (Supabase only; skipped on plain Postgres)
-- Contains no user data and no secrets.
--
-- Run ONCE, as the "postgres" login, on an EMPTY database. It is one
-- transaction: if anything fails, nothing is created. Re-running it on a
-- database that has these tables stops at the first CREATE and changes nothing.
--
--   psql "<postgres connection URL>" -v ON_ERROR_STOP=1 -f prisma/prod_schema.sql
--
-- Then give each service login a password (outside source control):
--   ALTER ROLE chat_service PASSWORD '<random secret>';   -- and the other five
-- and set each service's DATABASE_URL to its own login
-- (on Supabase's pooler the user is "<role>.<project ref>").
--
-- Later schema changes: add prisma/migrations/35_... and apply it to staging
-- and production alike. This file is not regenerated automatically.
-- =====================================================================

BEGIN;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Trigram search indexes need pg_trgm. It lives in "public", as on staging.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

SET search_path = '';

-- ---------------------------------------------------------------------
-- Service logins. BYPASSRLS because every table has row level security on
-- with no policies: that keeps Supabase's public API keys out, not the services.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'authentication_service',
    'user_service',
    'property_service',
    'chat_service',
    'payment_service',
    'notification_service'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN BYPASSRLS', role_name);
    END IF;
  END LOOP;
END $$;

-- pg_trgm (search indexes) lives in "public".
GRANT USAGE ON SCHEMA public TO
  authentication_service,
  user_service,
  property_service,
  chat_service,
  payment_service,
  notification_service;

SET default_tablespace = '';
SET default_table_access_method = heap;

--
-- Name: account; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA account;


--
-- Name: chat; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA chat;


--
-- Name: listing; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA listing;


--
-- Name: notification; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA notification;


--
-- Name: payment; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA payment;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: follows; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.follows (
    follower_id uuid NOT NULL,
    following_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follows_not_self_check CHECK ((follower_id <> following_id))
);


--
-- Name: password_reset_otps; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.password_reset_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    otp_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    device_id text,
    expires_at timestamp with time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid,
    session_started_at timestamp(6) with time zone,
    device_name text,
    platform text,
    ip_address text,
    location text
);


--
-- Name: reports; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    property_id uuid,
    reported_user_id uuid,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp(6) with time zone,
    reviewed_by uuid,
    review_note text,
    CONSTRAINT reports_details_length_check CHECK ((char_length(details) <= 1000)),
    CONSTRAINT reports_not_self_check CHECK ((reporter_id <> reported_user_id)),
    CONSTRAINT reports_one_target_check CHECK (((property_id IS NULL) <> (reported_user_id IS NULL))),
    CONSTRAINT reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'scam'::text, 'misleading'::text, 'inappropriate'::text, 'duplicate'::text, 'unavailable'::text, 'harassment'::text, 'impersonation'::text, 'other'::text]))),
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: user_blocks; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.user_blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_blocks_not_self_check CHECK ((blocker_id <> blocked_id))
);


--
-- Name: users; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text,
    email text,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    firebase_uid text,
    username text DEFAULT ('user_'::text || substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 10)),
    avatar_url text,
    backup_blob text,
    backup_nonce text,
    backup_salt text,
    identity_public_key text,
    last_seen_at timestamp(6) with time zone,
    name text,
    first_name text,
    last_name text,
    sex text,
    deactivated_at timestamp(6) with time zone,
    has_password boolean DEFAULT false NOT NULL,
    CONSTRAINT users_phone_or_email_check CHECK (((phone IS NOT NULL) OR (email IS NOT NULL))),
    CONSTRAINT users_sex_check CHECK ((sex = ANY (ARRAY['male'::text, 'female'::text, 'other'::text])))
);


--
-- Name: call_logs; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.call_logs (
    id uuid NOT NULL,
    caller_id uuid NOT NULL,
    callee_id uuid NOT NULL,
    status text DEFAULT 'ringing'::text NOT NULL,
    end_reason text,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    answered_at timestamp(6) with time zone,
    ended_at timestamp(6) with time zone,
    CONSTRAINT call_logs_end_reason_check CHECK (((end_reason IS NULL) OR (end_reason = ANY (ARRAY['ended'::text, 'declined'::text, 'missed'::text, 'cancelled'::text, 'disconnected'::text])))),
    CONSTRAINT call_logs_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'active'::text, 'ended'::text])))
);


--
-- Name: chat_conversation_states; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.chat_conversation_states (
    user_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    archived_at timestamp(6) with time zone,
    cleared_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_hidden_messages; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.chat_hidden_messages (
    user_id uuid NOT NULL,
    message_id uuid NOT NULL,
    hidden_at timestamp(6) with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_key_backups; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.chat_key_backups (
    user_id uuid NOT NULL,
    blob text NOT NULL,
    salt text NOT NULL,
    nonce text NOT NULL,
    verifier text NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp(6) with time zone,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    protected_by text DEFAULT 'pin'::text NOT NULL,
    CONSTRAINT chat_key_backups_protected_by_check CHECK ((protected_by = ANY (ARRAY['pin'::text, 'password'::text])))
);


--
-- Name: messages; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    ciphertext text NOT NULL,
    nonce text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read_at timestamp(6) with time zone,
    reply_to_id uuid,
    edited_at timestamp(6) with time zone
);


--
-- Name: guest_sessions; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.guest_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: keywords; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.keywords (
    code text NOT NULL
);


--
-- Name: properties; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    price numeric(12,2) NOT NULL,
    property_type text NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    bedrooms integer,
    bathrooms integer,
    land_size numeric(10,2),
    building_size numeric(10,2),
    unit_size numeric(10,2),
    total_project_area numeric(10,2),
    lat double precision,
    lng double precision,
    boundary_points jsonb,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    listing_type text,
    title_type text,
    contact_phone text,
    floors integer,
    floor_number integer,
    total_units integer,
    has_parking boolean,
    has_balcony boolean,
    furnishing text,
    building_type text,
    completion_status text,
    view_type text,
    maintenance_fee numeric(12,2),
    developer_name text,
    project_name text,
    project_type text,
    monthly_rent numeric(12,2),
    lease_remaining_months integer,
    equipment_included text,
    reason_for_selling text,
    nearby_searched_at timestamp(6) with time zone,
    discount_type text,
    discount_value numeric(12,2),
    published_at timestamp(6) with time zone,
    followers_notified_at timestamp(6) with time zone,
    price_dropped_at timestamp(6) with time zone,
    previous_price numeric(12,2),
    price_drop_notified_at timestamp(6) with time zone,
    CONSTRAINT properties_discount_check CHECK ((((discount_type IS NULL) AND (discount_value IS NULL)) OR ((discount_type = 'percent'::text) AND (discount_value > (0)::numeric) AND (discount_value < (100)::numeric)) OR ((discount_type = 'amount'::text) AND (discount_value > (0)::numeric) AND (discount_value < price))))
);


--
-- Name: property_contacts; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    email text,
    phone text,
    message text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: property_favorites; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_favorites (
    user_id uuid NOT NULL,
    property_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: property_images; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_id uuid NOT NULL,
    url text NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    thumbnail_url text
);


--
-- Name: property_keywords; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_keywords (
    property_id uuid NOT NULL,
    keyword text NOT NULL
);


--
-- Name: property_leads; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_leads (
    property_id uuid NOT NULL,
    user_id uuid NOT NULL,
    channel text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_leads_channel_check CHECK ((channel = ANY (ARRAY['call'::text, 'chat'::text])))
);


--
-- Name: property_likes; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_likes (
    user_id uuid NOT NULL,
    property_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: property_nearby_places; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_nearby_places (
    property_id uuid NOT NULL,
    category text NOT NULL,
    rank integer NOT NULL,
    name text NOT NULL,
    provider_place_id text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    straight_meters integer NOT NULL,
    road_meters integer,
    drive_seconds integer,
    CONSTRAINT property_nearby_places_category_check CHECK ((category = ANY (ARRAY['market'::text, 'hospital'::text, 'school'::text])))
);


--
-- Name: property_views; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.property_views (
    user_id uuid NOT NULL,
    property_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: saved_search_matches; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.saved_search_matches (
    saved_search_id uuid NOT NULL,
    property_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL
);


--
-- Name: saved_searches; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.saved_searches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    min_lat double precision NOT NULL,
    max_lat double precision NOT NULL,
    min_lng double precision NOT NULL,
    max_lng double precision NOT NULL,
    property_type text,
    listing_types text[] DEFAULT '{}'::text[] NOT NULL,
    min_price numeric(12,2),
    max_price numeric(12,2),
    min_size numeric(12,2),
    max_size numeric(12,2),
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    alerts boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_searches_area_check CHECK (((min_lat <= max_lat) AND (min_lng <= max_lng))),
    CONSTRAINT saved_searches_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60))),
    CONSTRAINT saved_searches_price_check CHECK (((min_price IS NULL) OR (max_price IS NULL) OR (min_price <= max_price))),
    CONSTRAINT saved_searches_size_check CHECK (((min_size IS NULL) OR (max_size IS NULL) OR (min_size <= max_size)))
);


--
-- Name: search_history; Type: TABLE; Schema: listing; Owner: -
--

CREATE TABLE listing.search_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    query text NOT NULL,
    normalized_query text NOT NULL,
    searched_at timestamp(6) with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.notification_preferences (
    user_id uuid NOT NULL,
    chat_messages boolean DEFAULT true NOT NULL,
    promotions boolean DEFAULT true NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    saved_search_alerts boolean DEFAULT true NOT NULL,
    followed_listings boolean DEFAULT true NOT NULL,
    saved_listing_updates boolean DEFAULT true NOT NULL
);


--
-- Name: promotions; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid,
    title text NOT NULL,
    body text NOT NULL,
    title_km text,
    body_km text,
    property_id uuid,
    url text,
    image_url text,
    status text DEFAULT 'queued'::text NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    started_at timestamp(6) with time zone,
    finished_at timestamp(6) with time zone,
    CONSTRAINT promotions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: push_devices; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.push_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid,
    token text NOT NULL,
    platform text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_devices_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'km'::text]))),
    CONSTRAINT push_devices_platform_check CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text])))
);


--
-- Name: payment_transactions; Type: TABLE; Schema: payment; Owner: -
--

CREATE TABLE payment.payment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    property_id uuid NOT NULL,
    provider text NOT NULL,
    external_id text,
    amount numeric(10,2) NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL
);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, following_id);


--
-- Name: password_reset_otps password_reset_otps_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.password_reset_otps
    ADD CONSTRAINT password_reset_otps_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_firebase_uid_key; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.users
    ADD CONSTRAINT users_firebase_uid_key UNIQUE (firebase_uid);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: call_logs call_logs_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.call_logs
    ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);


--
-- Name: chat_conversation_states chat_conversation_states_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_conversation_states
    ADD CONSTRAINT chat_conversation_states_pkey PRIMARY KEY (user_id, partner_id);


--
-- Name: chat_hidden_messages chat_hidden_messages_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_hidden_messages
    ADD CONSTRAINT chat_hidden_messages_pkey PRIMARY KEY (user_id, message_id);


--
-- Name: chat_key_backups chat_key_backups_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_key_backups
    ADD CONSTRAINT chat_key_backups_pkey PRIMARY KEY (user_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: guest_sessions guest_sessions_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.guest_sessions
    ADD CONSTRAINT guest_sessions_pkey PRIMARY KEY (id);


--
-- Name: keywords keywords_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.keywords
    ADD CONSTRAINT keywords_pkey PRIMARY KEY (code);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: property_contacts property_contacts_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_contacts
    ADD CONSTRAINT property_contacts_pkey PRIMARY KEY (id);


--
-- Name: property_favorites property_favorites_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_favorites
    ADD CONSTRAINT property_favorites_pkey PRIMARY KEY (user_id, property_id);


--
-- Name: property_images property_images_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_images
    ADD CONSTRAINT property_images_pkey PRIMARY KEY (id);


--
-- Name: property_keywords property_keywords_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_keywords
    ADD CONSTRAINT property_keywords_pkey PRIMARY KEY (property_id, keyword);


--
-- Name: property_leads property_leads_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_leads
    ADD CONSTRAINT property_leads_pkey PRIMARY KEY (property_id, user_id, channel);


--
-- Name: property_likes property_likes_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_likes
    ADD CONSTRAINT property_likes_pkey PRIMARY KEY (user_id, property_id);


--
-- Name: property_nearby_places property_nearby_places_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_nearby_places
    ADD CONSTRAINT property_nearby_places_pkey PRIMARY KEY (property_id, category, rank);


--
-- Name: property_views property_views_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_views
    ADD CONSTRAINT property_views_pkey PRIMARY KEY (user_id, property_id);


--
-- Name: saved_search_matches saved_search_matches_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.saved_search_matches
    ADD CONSTRAINT saved_search_matches_pkey PRIMARY KEY (saved_search_id, property_id);


--
-- Name: saved_searches saved_searches_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.saved_searches
    ADD CONSTRAINT saved_searches_pkey PRIMARY KEY (id);


--
-- Name: search_history search_history_pkey; Type: CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.search_history
    ADD CONSTRAINT search_history_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: push_devices push_devices_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.push_devices
    ADD CONSTRAINT push_devices_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: payment; Owner: -
--

ALTER TABLE ONLY payment.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: follows_following_id_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX follows_following_id_idx ON account.follows USING btree (following_id);


--
-- Name: idx_password_reset_otps_email; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_password_reset_otps_email ON account.password_reset_otps USING btree (email);


--
-- Name: idx_refresh_tokens_expires_at; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_refresh_tokens_expires_at ON account.refresh_tokens USING btree (expires_at);


--
-- Name: idx_refresh_tokens_session_id; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_refresh_tokens_session_id ON account.refresh_tokens USING btree (session_id);


--
-- Name: idx_refresh_tokens_user_id; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_refresh_tokens_user_id ON account.refresh_tokens USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_users_email ON account.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_users_firebase_uid; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_users_firebase_uid ON account.users USING btree (firebase_uid) WHERE (firebase_uid IS NOT NULL);


--
-- Name: idx_users_name_trgm; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_users_name_trgm ON account.users USING gin (name public.gin_trgm_ops);


--
-- Name: idx_users_phone; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_users_phone ON account.users USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: idx_users_username_trgm; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX idx_users_username_trgm ON account.users USING gin (username public.gin_trgm_ops);


--
-- Name: reports_open_listing_key; Type: INDEX; Schema: account; Owner: -
--

CREATE UNIQUE INDEX reports_open_listing_key ON account.reports USING btree (reporter_id, property_id) WHERE ((status = 'open'::text) AND (property_id IS NOT NULL));


--
-- Name: reports_open_user_key; Type: INDEX; Schema: account; Owner: -
--

CREATE UNIQUE INDEX reports_open_user_key ON account.reports USING btree (reporter_id, reported_user_id) WHERE ((status = 'open'::text) AND (reported_user_id IS NOT NULL));


--
-- Name: reports_status_created_at_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX reports_status_created_at_idx ON account.reports USING btree (status, created_at);


--
-- Name: user_blocks_blocked_id_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX user_blocks_blocked_id_idx ON account.user_blocks USING btree (blocked_id);


--
-- Name: users_username_key; Type: INDEX; Schema: account; Owner: -
--

CREATE UNIQUE INDEX users_username_key ON account.users USING btree (username);


--
-- Name: call_logs_callee_id_created_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX call_logs_callee_id_created_at_idx ON chat.call_logs USING btree (callee_id, created_at);


--
-- Name: call_logs_caller_id_created_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX call_logs_caller_id_created_at_idx ON chat.call_logs USING btree (caller_id, created_at);


--
-- Name: chat_conversation_states_partner_id_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_conversation_states_partner_id_idx ON chat.chat_conversation_states USING btree (partner_id);


--
-- Name: chat_hidden_messages_message_id_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_hidden_messages_message_id_idx ON chat.chat_hidden_messages USING btree (message_id);


--
-- Name: messages_recipient_id_created_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX messages_recipient_id_created_at_idx ON chat.messages USING btree (recipient_id, created_at);


--
-- Name: messages_recipient_id_read_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX messages_recipient_id_read_at_idx ON chat.messages USING btree (recipient_id, read_at);


--
-- Name: messages_recipient_id_sender_id_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX messages_recipient_id_sender_id_idx ON chat.messages USING btree (recipient_id, sender_id);


--
-- Name: messages_reply_to_id_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX messages_reply_to_id_idx ON chat.messages USING btree (reply_to_id);


--
-- Name: messages_sender_id_recipient_id_created_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX messages_sender_id_recipient_id_created_at_idx ON chat.messages USING btree (sender_id, recipient_id, created_at);


--
-- Name: guest_sessions_device_id_key; Type: INDEX; Schema: listing; Owner: -
--

CREATE UNIQUE INDEX guest_sessions_device_id_key ON listing.guest_sessions USING btree (device_id);


--
-- Name: idx_properties_description_trgm; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX idx_properties_description_trgm ON listing.properties USING gin (description public.gin_trgm_ops);


--
-- Name: idx_properties_title_trgm; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX idx_properties_title_trgm ON listing.properties USING gin (title public.gin_trgm_ops);


--
-- Name: properties_active_newest_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_active_newest_idx ON listing.properties USING btree (created_at DESC) WHERE (status = 'Active'::text);


--
-- Name: properties_active_owner_published_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_active_owner_published_idx ON listing.properties USING btree (user_id, published_at DESC, id) WHERE (status = 'Active'::text);


--
-- Name: properties_lat_lng_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_lat_lng_idx ON listing.properties USING btree (lat, lng);


--
-- Name: properties_status_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_status_idx ON listing.properties USING btree (status);


--
-- Name: properties_status_lat_lng_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_status_lat_lng_idx ON listing.properties USING btree (status, lat, lng);


--
-- Name: properties_status_listing_type_lat_lng_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_status_listing_type_lat_lng_idx ON listing.properties USING btree (status, listing_type, lat, lng);


--
-- Name: properties_status_property_type_lat_lng_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_status_property_type_lat_lng_idx ON listing.properties USING btree (status, property_type, lat, lng);


--
-- Name: properties_user_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX properties_user_id_idx ON listing.properties USING btree (user_id);


--
-- Name: property_contacts_property_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_contacts_property_id_idx ON listing.property_contacts USING btree (property_id);


--
-- Name: property_contacts_user_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_contacts_user_id_idx ON listing.property_contacts USING btree (user_id);


--
-- Name: property_favorites_property_id_created_at_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_favorites_property_id_created_at_idx ON listing.property_favorites USING btree (property_id, created_at);


--
-- Name: property_favorites_property_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_favorites_property_id_idx ON listing.property_favorites USING btree (property_id);


--
-- Name: property_images_property_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_images_property_id_idx ON listing.property_images USING btree (property_id);


--
-- Name: property_keywords_keyword_property_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_keywords_keyword_property_id_idx ON listing.property_keywords USING btree (keyword, property_id);


--
-- Name: property_leads_property_id_created_at_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_leads_property_id_created_at_idx ON listing.property_leads USING btree (property_id, created_at);


--
-- Name: property_likes_property_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_likes_property_id_idx ON listing.property_likes USING btree (property_id);


--
-- Name: property_views_property_id_created_at_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_views_property_id_created_at_idx ON listing.property_views USING btree (property_id, created_at);


--
-- Name: property_views_property_id_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX property_views_property_id_idx ON listing.property_views USING btree (property_id);


--
-- Name: saved_searches_alert_area_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX saved_searches_alert_area_idx ON listing.saved_searches USING btree (min_lat, max_lat) WHERE alerts;


--
-- Name: saved_searches_user_id_created_at_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX saved_searches_user_id_created_at_idx ON listing.saved_searches USING btree (user_id, created_at DESC);


--
-- Name: search_history_searched_at_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX search_history_searched_at_idx ON listing.search_history USING btree (searched_at);


--
-- Name: search_history_user_id_normalized_query_key; Type: INDEX; Schema: listing; Owner: -
--

CREATE UNIQUE INDEX search_history_user_id_normalized_query_key ON listing.search_history USING btree (user_id, normalized_query);


--
-- Name: search_history_user_id_searched_at_idx; Type: INDEX; Schema: listing; Owner: -
--

CREATE INDEX search_history_user_id_searched_at_idx ON listing.search_history USING btree (user_id, searched_at DESC);


--
-- Name: promotions_created_at_idx; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX promotions_created_at_idx ON notification.promotions USING btree (created_at);


--
-- Name: push_devices_session_id_idx; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX push_devices_session_id_idx ON notification.push_devices USING btree (session_id);


--
-- Name: push_devices_token_key; Type: INDEX; Schema: notification; Owner: -
--

CREATE UNIQUE INDEX push_devices_token_key ON notification.push_devices USING btree (token);


--
-- Name: push_devices_user_id_idx; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX push_devices_user_id_idx ON notification.push_devices USING btree (user_id);


--
-- Name: payment_transactions_property_id_idx; Type: INDEX; Schema: payment; Owner: -
--

CREATE INDEX payment_transactions_property_id_idx ON payment.payment_transactions USING btree (property_id);


--
-- Name: payment_transactions_user_id_idx; Type: INDEX; Schema: payment; Owner: -
--

CREATE INDEX payment_transactions_user_id_idx ON payment.payment_transactions USING btree (user_id);


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: follows follows_following_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_property_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.reports
    ADD CONSTRAINT reports_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reports reports_reported_user_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.reports
    ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reports reports_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.reports
    ADD CONSTRAINT reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: call_logs call_logs_callee_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.call_logs
    ADD CONSTRAINT call_logs_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: call_logs call_logs_caller_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.call_logs
    ADD CONSTRAINT call_logs_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_conversation_states chat_conversation_states_partner_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_conversation_states
    ADD CONSTRAINT chat_conversation_states_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_conversation_states chat_conversation_states_user_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_conversation_states
    ADD CONSTRAINT chat_conversation_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_hidden_messages chat_hidden_messages_message_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_hidden_messages
    ADD CONSTRAINT chat_hidden_messages_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat.messages(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_hidden_messages chat_hidden_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_hidden_messages
    ADD CONSTRAINT chat_hidden_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_key_backups chat_key_backups_user_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.chat_key_backups
    ADD CONSTRAINT chat_key_backups_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: messages messages_recipient_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.messages
    ADD CONSTRAINT messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: messages messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.messages
    ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES chat.messages(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: properties properties_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.properties
    ADD CONSTRAINT properties_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_contacts property_contacts_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_contacts
    ADD CONSTRAINT property_contacts_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_contacts property_contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_contacts
    ADD CONSTRAINT property_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_favorites property_favorites_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_favorites
    ADD CONSTRAINT property_favorites_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_favorites property_favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_favorites
    ADD CONSTRAINT property_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_images property_images_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_images
    ADD CONSTRAINT property_images_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_keywords property_keywords_keyword_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_keywords
    ADD CONSTRAINT property_keywords_keyword_fkey FOREIGN KEY (keyword) REFERENCES listing.keywords(code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: property_keywords property_keywords_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_keywords
    ADD CONSTRAINT property_keywords_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_leads property_leads_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_leads
    ADD CONSTRAINT property_leads_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_leads property_leads_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_leads
    ADD CONSTRAINT property_leads_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_likes property_likes_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_likes
    ADD CONSTRAINT property_likes_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_likes property_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_likes
    ADD CONSTRAINT property_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_nearby_places property_nearby_places_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_nearby_places
    ADD CONSTRAINT property_nearby_places_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_views property_views_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_views
    ADD CONSTRAINT property_views_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: property_views property_views_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.property_views
    ADD CONSTRAINT property_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: saved_search_matches saved_search_matches_property_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.saved_search_matches
    ADD CONSTRAINT saved_search_matches_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: saved_search_matches saved_search_matches_saved_search_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.saved_search_matches
    ADD CONSTRAINT saved_search_matches_saved_search_id_fkey FOREIGN KEY (saved_search_id) REFERENCES listing.saved_searches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: saved_searches saved_searches_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.saved_searches
    ADD CONSTRAINT saved_searches_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: search_history search_history_user_id_fkey; Type: FK CONSTRAINT; Schema: listing; Owner: -
--

ALTER TABLE ONLY listing.search_history
    ADD CONSTRAINT search_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: promotions promotions_created_by_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.promotions
    ADD CONSTRAINT promotions_created_by_fkey FOREIGN KEY (created_by) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: promotions promotions_property_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.promotions
    ADD CONSTRAINT promotions_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: push_devices push_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.push_devices
    ADD CONSTRAINT push_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_transactions payment_transactions_property_id_fkey; Type: FK CONSTRAINT; Schema: payment; Owner: -
--

ALTER TABLE ONLY payment.payment_transactions
    ADD CONSTRAINT payment_transactions_property_id_fkey FOREIGN KEY (property_id) REFERENCES listing.properties(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_transactions payment_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: payment; Owner: -
--

ALTER TABLE ONLY payment.payment_transactions
    ADD CONSTRAINT payment_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: follows; Type: ROW SECURITY; Schema: account; Owner: -
--

ALTER TABLE account.follows ENABLE ROW LEVEL SECURITY;

--
-- Name: password_reset_otps; Type: ROW SECURITY; Schema: account; Owner: -
--

ALTER TABLE account.password_reset_otps ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: account; Owner: -
--

ALTER TABLE account.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: reports; Type: ROW SECURITY; Schema: account; Owner: -
--

ALTER TABLE account.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: user_blocks; Type: ROW SECURITY; Schema: account; Owner: -
--

ALTER TABLE account.user_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: account; Owner: -
--

ALTER TABLE account.users ENABLE ROW LEVEL SECURITY;

--
-- Name: call_logs; Type: ROW SECURITY; Schema: chat; Owner: -
--

ALTER TABLE chat.call_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_conversation_states; Type: ROW SECURITY; Schema: chat; Owner: -
--

ALTER TABLE chat.chat_conversation_states ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_hidden_messages; Type: ROW SECURITY; Schema: chat; Owner: -
--

ALTER TABLE chat.chat_hidden_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_key_backups; Type: ROW SECURITY; Schema: chat; Owner: -
--

ALTER TABLE chat.chat_key_backups ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: chat; Owner: -
--

ALTER TABLE chat.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_sessions; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.guest_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: keywords; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.keywords ENABLE ROW LEVEL SECURITY;

--
-- Name: properties; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.properties ENABLE ROW LEVEL SECURITY;

--
-- Name: property_contacts; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: property_favorites; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: property_images; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_images ENABLE ROW LEVEL SECURITY;

--
-- Name: property_keywords; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_keywords ENABLE ROW LEVEL SECURITY;

--
-- Name: property_leads; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_leads ENABLE ROW LEVEL SECURITY;

--
-- Name: property_likes; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_likes ENABLE ROW LEVEL SECURITY;

--
-- Name: property_nearby_places; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_nearby_places ENABLE ROW LEVEL SECURITY;

--
-- Name: property_views; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.property_views ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_search_matches; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.saved_search_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_searches; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.saved_searches ENABLE ROW LEVEL SECURITY;

--
-- Name: search_history; Type: ROW SECURITY; Schema: listing; Owner: -
--

ALTER TABLE listing.search_history ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: notification; Owner: -
--

ALTER TABLE notification.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: promotions; Type: ROW SECURITY; Schema: notification; Owner: -
--

ALTER TABLE notification.promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_devices; Type: ROW SECURITY; Schema: notification; Owner: -
--

ALTER TABLE notification.push_devices ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_transactions; Type: ROW SECURITY; Schema: payment; Owner: -
--

ALTER TABLE payment.payment_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA account; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA account TO authentication_service;
GRANT USAGE ON SCHEMA account TO user_service;
GRANT USAGE ON SCHEMA account TO property_service;
GRANT USAGE ON SCHEMA account TO chat_service;
GRANT USAGE ON SCHEMA account TO notification_service;


--
-- Name: SCHEMA chat; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA chat TO chat_service;


--
-- Name: SCHEMA listing; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA listing TO property_service;


--
-- Name: SCHEMA notification; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA notification TO notification_service;


--
-- Name: SCHEMA payment; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA payment TO payment_service;


--
-- Name: TABLE follows; Type: ACL; Schema: account; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE account.follows TO user_service;


--
-- Name: TABLE password_reset_otps; Type: ACL; Schema: account; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE account.password_reset_otps TO authentication_service;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: account; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE account.refresh_tokens TO authentication_service;


--
-- Name: TABLE reports; Type: ACL; Schema: account; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE account.reports TO user_service;


--
-- Name: TABLE user_blocks; Type: ACL; Schema: account; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE account.user_blocks TO user_service;


--
-- Name: TABLE users; Type: ACL; Schema: account; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE account.users TO authentication_service;
GRANT SELECT,UPDATE ON TABLE account.users TO user_service;
GRANT SELECT ON TABLE account.users TO property_service;
GRANT SELECT ON TABLE account.users TO chat_service;
GRANT SELECT ON TABLE account.users TO notification_service;


--
-- Name: COLUMN users.backup_blob; Type: ACL; Schema: account; Owner: -
--

GRANT UPDATE(backup_blob) ON TABLE account.users TO chat_service;


--
-- Name: COLUMN users.backup_nonce; Type: ACL; Schema: account; Owner: -
--

GRANT UPDATE(backup_nonce) ON TABLE account.users TO chat_service;


--
-- Name: COLUMN users.backup_salt; Type: ACL; Schema: account; Owner: -
--

GRANT UPDATE(backup_salt) ON TABLE account.users TO chat_service;


--
-- Name: COLUMN users.identity_public_key; Type: ACL; Schema: account; Owner: -
--

GRANT UPDATE(identity_public_key) ON TABLE account.users TO chat_service;


--
-- Name: COLUMN users.last_seen_at; Type: ACL; Schema: account; Owner: -
--

GRANT UPDATE(last_seen_at) ON TABLE account.users TO chat_service;


--
-- Name: TABLE call_logs; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.call_logs TO chat_service;


--
-- Name: TABLE chat_conversation_states; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.chat_conversation_states TO chat_service;


--
-- Name: TABLE chat_hidden_messages; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.chat_hidden_messages TO chat_service;


--
-- Name: TABLE chat_key_backups; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.chat_key_backups TO chat_service;


--
-- Name: TABLE messages; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.messages TO chat_service;


--
-- Name: TABLE guest_sessions; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.guest_sessions TO property_service;


--
-- Name: TABLE keywords; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.keywords TO property_service;


--
-- Name: TABLE properties; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.properties TO property_service;


--
-- Name: TABLE property_contacts; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_contacts TO property_service;


--
-- Name: TABLE property_favorites; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_favorites TO property_service;


--
-- Name: TABLE property_images; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_images TO property_service;


--
-- Name: TABLE property_keywords; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_keywords TO property_service;


--
-- Name: TABLE property_leads; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_leads TO property_service;


--
-- Name: TABLE property_likes; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_likes TO property_service;


--
-- Name: TABLE property_nearby_places; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_nearby_places TO property_service;


--
-- Name: TABLE property_views; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.property_views TO property_service;


--
-- Name: TABLE saved_search_matches; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.saved_search_matches TO property_service;


--
-- Name: TABLE saved_searches; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.saved_searches TO property_service;


--
-- Name: TABLE search_history; Type: ACL; Schema: listing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE listing.search_history TO property_service;


--
-- Name: TABLE notification_preferences; Type: ACL; Schema: notification; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE notification.notification_preferences TO notification_service;


--
-- Name: TABLE promotions; Type: ACL; Schema: notification; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE notification.promotions TO notification_service;


--
-- Name: TABLE push_devices; Type: ACL; Schema: notification; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE notification.push_devices TO notification_service;


--
-- Name: TABLE payment_transactions; Type: ACL; Schema: payment; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE payment.payment_transactions TO payment_service;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: chat; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA chat GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO chat_service;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: listing; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA listing GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO property_service;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: notification; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA notification GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO notification_service;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: payment; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA payment GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO payment_service;


--
-- PostgreSQL database dump complete
--

-- =====================================================================
-- Prisma's bookkeeping table (schema changes are applied with
-- scripts/apply-migrations.js, not prisma migrate)
-- =====================================================================

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: _prisma_migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

-- =====================================================================
-- Reference data
-- =====================================================================

-- Listing keywords (feature tags shown on listings and in map filters).
INSERT INTO listing.keywords (code) VALUES
  ('road_access'),
  ('corner_land'),
  ('near_market'),
  ('near_school'),
  ('near_hospital'),
  ('river_lake_nearby'),
  ('electricity_ready'),
  ('water_supply'),
  ('residential_area'),
  ('commercial_area');

-- Prisma baseline marker, as on staging.
INSERT INTO public._prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
   now(), '0_init', '', NULL, now(), 0);

-- =====================================================================
-- Storage buckets (Supabase only; skipped on plain Postgres).
-- The services also create/update these on start, so this is a head start.
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('avatars',          'avatars',          true,  2097152,  ARRAY['image/jpeg','image/png','image/webp']),
      ('chat-attachments', 'chat-attachments', false, 12582912, NULL),
      ('property-images',  'property-images',  true,  8388608,  ARRAY['image/jpeg','image/png','image/webp'])
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

COMMIT;
