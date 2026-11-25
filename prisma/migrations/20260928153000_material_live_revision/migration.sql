-- Supports the shared material-library revision check without scanning all assets.
CREATE INDEX IF NOT EXISTS "MaterialAsset_updatedAt_id_idx" ON "MaterialAsset"("updatedAt", "id");
