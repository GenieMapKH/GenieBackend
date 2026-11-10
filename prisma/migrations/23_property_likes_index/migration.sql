-- A listing's likes, found from the listing. The primary key starts with the
-- user, so without this deleting a listing (its likes go with it) reads every
-- like there is. Indexes only: safe before or after the code that uses it.
CREATE INDEX IF NOT EXISTS "property_likes_property_id_idx"
  ON "property_likes" ("property_id");
