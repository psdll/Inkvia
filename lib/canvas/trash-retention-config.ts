export const CANVAS_TRASH_RETENTION_DAYS = 30;

export function canvasTrashRetentionCutoff(now = new Date()) {
  return new Date(
    now.getTime() - CANVAS_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}
