import type { CanvasViewport } from "@/lib/canvas/document";

type ViewportStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const STORAGE_PREFIX = "canvas_viewport_v1_";

function storageKey(ownerId: number | string, canvasId: number) {
  return `${STORAGE_PREFIX}${ownerId}_${canvasId}`;
}

function isCanvasViewport(value: unknown): value is CanvasViewport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CanvasViewport>;
  return Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.zoom)
    && Number(candidate.zoom) > 0;
}

export function readCanvasViewportPreference(
  storage: ViewportStorage,
  ownerId: number | string,
  canvasId: number,
): CanvasViewport | null {
  try {
    const value = JSON.parse(storage.getItem(storageKey(ownerId, canvasId)) || "null");
    return isCanvasViewport(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeCanvasViewportPreference(
  storage: ViewportStorage,
  ownerId: number | string,
  canvasId: number,
  viewport: CanvasViewport,
) {
  if (!isCanvasViewport(viewport)) return;
  try {
    storage.setItem(storageKey(ownerId, canvasId), JSON.stringify(viewport));
  } catch {
    // Storage may be unavailable in private browsing or under a strict quota.
  }
}
