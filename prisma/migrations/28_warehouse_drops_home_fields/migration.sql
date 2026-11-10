-- A warehouse's form no longer asks for bedrooms, bathrooms or furnishing,
-- and the server now clears them on every write. Clear what earlier
-- listings saved, so their details do not show them.
UPDATE "properties"
SET "bedrooms" = NULL, "bathrooms" = NULL, "furnishing" = NULL
WHERE "property_type" = 'Warehouse'
  AND ("bedrooms" IS NOT NULL OR "bathrooms" IS NOT NULL OR "furnishing" IS NOT NULL);
