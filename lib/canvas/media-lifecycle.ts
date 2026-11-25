export const CANVAS_MEDIA_STATUSES = [
  "initiated",
  "ready",
  "failed",
  "soft_deleted",
  "purging",
  "purged",
] as const;

export type CanvasMediaStatus = typeof CANVAS_MEDIA_STATUSES[number];

const ALLOWED_TRANSITIONS: Record<CanvasMediaStatus, ReadonlySet<CanvasMediaStatus>> = {
  initiated: new Set(["ready", "failed", "soft_deleted", "purging"]),
  ready: new Set(["soft_deleted"]),
  failed: new Set(["soft_deleted", "purging"]),
  soft_deleted: new Set(["ready", "purging"]),
  purging: new Set(["purged"]),
  purged: new Set(),
};

export function assertCanvasMediaTransition(from: CanvasMediaStatus, to: CanvasMediaStatus) {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    throw new Error(`MEDIA_INVALID_TRANSITION: ${from} -> ${to}`);
  }
}
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export function canvasMediaRetentionDeadline(status: CanvasMediaStatus, from: Date): Date {
  const retentionMs = status === "initiated"
    ? DAY_MS
    : status === "failed"
      ? 7 * DAY_MS
      : status === "soft_deleted"
        ? 30 * DAY_MS
        : 0;
  return new Date(from.getTime() + retentionMs);
}

export function isCanvasMediaGarbageCollectable(
  asset: { status: CanvasMediaStatus; referenceCount: number; retentionUntil: Date | null },
  now = new Date(),
): boolean {
  if (asset.referenceCount > 0) return false;
  if (asset.status !== "initiated" && asset.status !== "failed" && asset.status !== "soft_deleted") return false;
  return Boolean(asset.retentionUntil && asset.retentionUntil.getTime() <= now.getTime());
}
