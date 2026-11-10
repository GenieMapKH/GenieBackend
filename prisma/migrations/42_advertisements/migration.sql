CREATE TABLE listing.advertisements (
  id uuid PRIMARY KEY,
  image_path text NOT NULL UNIQUE,
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advertisements_created_idx ON listing.advertisements(created_at);
ALTER TABLE listing.advertisements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON listing.advertisements FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON listing.advertisements TO property_service;
