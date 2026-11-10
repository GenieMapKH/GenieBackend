-- A small copy of each listing photo, for cards, lists and the map. Null
-- until it is made (photos uploaded before this, or when making it failed):
-- the app then shows the original.
ALTER TABLE "property_images" ADD COLUMN IF NOT EXISTS "thumbnail_url" TEXT;
