BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "MediaReference"
  DROP CONSTRAINT "MediaReference_sourceType_check";

ALTER TABLE "MediaReference"
  ADD CONSTRAINT "MediaReference_sourceType_check" CHECK ("sourceType" IN (
    'canvas_current',
    'canvas_snapshot',
    'generation',
    'library',
    'batch_workspace'
  ));

COMMIT;
