import { isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";

export type MediaLibraryScope = "shared" | "private";
export type MediaLibraryKind = "image" | "video" | "audio";
export const MEDIA_LIBRARY_UNGROUPED = "__ungrouped__";

export function normalizeMediaLibraryScope(raw: unknown): MediaLibraryScope {
  return String(raw || "").trim().toLowerCase() === "shared" ? "shared" : "private";
}

export function normalizeMediaLibraryKind(raw: unknown): MediaLibraryKind {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "video") return "video";
  if (value === "audio") return "audio";
  return "image";
}

export function inferMediaLibraryKind(input: { type?: string | null; name?: string | null; url?: string | null }): MediaLibraryKind {
  const mime = String(input.type || "").toLowerCase();
  const name = String(input.name || "").toLowerCase();
  const url = normalizeMediaUrl(input.url || "");
  if (mime.startsWith("audio/")) return "audio";
  if (
    name.endsWith(".mp3") ||
    name.endsWith(".wav") ||
    name.endsWith(".m4a") ||
    name.endsWith(".aac") ||
    name.endsWith(".flac") ||
    name.endsWith(".ogg")
  ) {
    return "audio";
  }
  if (mime.startsWith("video/")) return "video";
  if (isVideoMediaUrl(url) || name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".webm") || name.endsWith(".m4v")) {
    return "video";
  }
  return "image";
}

export function parseMediaLibraryTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parseMediaLibraryTags(parsed);
  } catch {}
  return text
    .split(/[,\n，]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function stringifyMediaLibraryTags(tags: string[]) {
  return JSON.stringify(parseMediaLibraryTags(tags));
}

export function normalizeMediaLibraryGroupName(raw: unknown) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 80) : null;
}

export function isUngroupedMediaLibraryGroup(raw: unknown) {
  return String(raw || "").trim() === MEDIA_LIBRARY_UNGROUPED;
}

export function buildMediaLibraryTitle(rawTitle: unknown, fallbackName: string, index = 0) {
  const text = String(rawTitle || "").trim();
  if (text) return text.slice(0, 120);
  const fallback = String(fallbackName || "").trim();
  if (fallback) return fallback.slice(0, 120);
  return `素材_${index || Date.now()}`;
}
