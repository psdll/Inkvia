-- Preserve provenance independently of the current canvas document.
UPDATE "Generation" g SET "canvasId" = r."canvasId"
FROM "CanvasRunStep" s JOIN "CanvasRun" r ON r."id" = s."runId"
WHERE g."canvasId" IS NULL AND g."source" = 'canvas' AND g."requestKey" = s."requestKey"
  AND g."authUserId" = s."authUserId";

UPDATE "Generation" g SET "canvasId" = r."canvasId"
FROM "CanvasRunOutput" o JOIN "CanvasRunStep" s ON s."id" = o."runStepId"
JOIN "CanvasRun" r ON r."id" = s."runId"
WHERE g."canvasId" IS NULL AND g."source" = 'canvas'
  AND o."generationId" = g."id" AND g."authUserId" = s."authUserId";

-- Old direct generations can be recovered from saved task nodes. Only use
-- unambiguous ownership; copied nodes must not assign a guessed canvas.
WITH refs AS (
  SELECT n."canvasId", c."authUserId", ref #>> '{}' AS generation_id
  FROM "CanvasNodeState" n JOIN "Canvas" c ON c."id" = n."canvasId"
  CROSS JOIN LATERAL jsonb_path_query(n."data", '$.**.generationId') ref
), unique_refs AS (
  SELECT generation_id, "authUserId", MIN("canvasId") AS canvas_id
  FROM refs WHERE generation_id ~ '^[0-9]+$'
  GROUP BY generation_id, "authUserId" HAVING COUNT(DISTINCT "canvasId") = 1
)
UPDATE "Generation" g SET "canvasId" = u.canvas_id FROM unique_refs u
WHERE g."canvasId" IS NULL AND g."source" = 'canvas'
  AND g."id"::text = u.generation_id AND g."authUserId" = u."authUserId";
