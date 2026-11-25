import { buildMediaOriginalCandidates, buildMediaOriginalUrl, buildMediaPreviewCandidates, normalizeMediaUrl } from "@/lib/media-url";

export function buildCanvasImageCandidates(raw: string, tier: number | "original", mode?: "cover" | "contain") {
  const source = normalizeMediaUrl(raw);
  if (getCanvasLocalVideoPosterSource(source)) return [{ url: `/api/thumb?src=${encodeURIComponent(source)}&w=${tier === "original" ? 800 : tier}&poster=1`, original: false }];
  if (source.startsWith("data:") || source.startsWith("blob:")) return [{ url: source, original: true }];
  const original = buildMediaOriginalUrl(source);
  if (!source) return [];
  const originals = source.startsWith("/uploads/") ? [original] : buildMediaOriginalCandidates(source);
  const urls = tier === "original" ? originals : source.startsWith("/uploads/")
    ? [`/api/thumb?src=${encodeURIComponent(source)}&w=${tier}`, original]
    : [...buildMediaPreviewCandidates(source, { width: tier, height: tier, mode }), ...originals];
  return Array.from(new Set(urls)).map(url => ({ url, original: originals.includes(url) }));
}

export function getCanvasLocalVideoPosterSource(raw?: string) {
  return raw?.startsWith("/uploads/") && /\.(mp4|mov|webm|mkv)$/i.test(raw) ? raw : undefined;
}
