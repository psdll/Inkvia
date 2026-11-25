const CANVAS_IMPORT_ROOT = "/uploads/canvas_imports/";

export function normalizeCanvasImportRef(value: unknown): string {
  let text = String(value || "").trim().replaceAll("\\", "/");
  if (!text) return "";

  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname;
    } catch {
      return "";
    }
  } else {
    const index = text.indexOf(CANVAS_IMPORT_ROOT);
    if (index >= 0) text = text.slice(index);
  }

  if (text.startsWith("uploads/")) text = `/${text}`;
  if (!text.startsWith(CANVAS_IMPORT_ROOT)) return "";
  return text.split(/[?#\s"'\\]/)[0] || "";
}

export function collectCanvasImportRefs(value: unknown): Set<string> {
  const refs = new Set<string>();
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "string") {
      const ref = normalizeCanvasImportRef(current);
      if (ref) refs.add(ref);
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (current && typeof current === "object") {
      stack.push(...Object.values(current as Record<string, unknown>));
    }
  }
  return refs;
}

export function canvasImportUserPrefix(userId: number | string) {
  return `${CANVAS_IMPORT_ROOT}${String(userId)}/`;
}
