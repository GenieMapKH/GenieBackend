ALTER TABLE listing.advertisements
  ADD COLUMN IF NOT EXISTS width integer CHECK (width > 0),
  ADD COLUMN IF NOT EXISTS height integer CHECK (height > 0);
