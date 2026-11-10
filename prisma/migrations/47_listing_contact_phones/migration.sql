ALTER TABLE listing.properties ADD COLUMN IF NOT EXISTS additional_contact_phones text[] NOT NULL DEFAULT ARRAY[]::text[];
