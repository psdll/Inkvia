ALTER TABLE "MaterialAsset"
  ADD COLUMN IF NOT EXISTS "media" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "mediaCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "selectedMediaId" TEXT;

ALTER TABLE "MaterialAssetSelectionEvent"
  ADD COLUMN IF NOT EXISTS "selectedMediaId" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedMediaUrl" TEXT;

UPDATE "MaterialAsset"
SET
  "media" = jsonb_build_array(
    jsonb_build_object(
      'id', CONCAT('legacy_', "id"::text),
      'originalUrl', "imageUrl",
      'thumbnailUrl', "thumbnailUrl",
      'previewUrl', "previewUrl",
      'mime', "mimeType",
      'size', "sizeBytes"
    )
  ),
  "mediaCount" = 1
WHERE jsonb_typeof("media") = 'array'
  AND jsonb_array_length("media") = 0;
