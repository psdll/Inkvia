-- Keep numeric IDs and all existing relations. Assign a stable public ID to every canvas.
ALTER TABLE "Canvas"
ADD COLUMN "publicId" VARCHAR(32) NOT NULL
DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text);

CREATE UNIQUE INDEX "Canvas_publicId_key" ON "Canvas"("publicId");
