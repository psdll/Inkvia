export const DEFAULT_CANVAS_TITLE = "未命名项目";
export const LEGACY_DEFAULT_CANVAS_TITLE = "未命名画布";

export function normalizeCanvasTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title === LEGACY_DEFAULT_CANVAS_TITLE) return DEFAULT_CANVAS_TITLE;
  return title;
}

export function applyCanvasBrowserTitle(value: unknown, target: { title: string }): string {
  const title = normalizeCanvasTitle(value);
  target.title = title;
  return title;
}
