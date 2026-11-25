import { buildMediaPreviewCandidates, buildMediaProxyUrl, isVideoMediaUrl } from "@/lib/media-url";

export type MaterialCardPreviewSource = {
  imageUrl: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  mimeType?: string | null;
  mediaItems?: Array<{ width?: number | null }>;
};

export const MATERIAL_CARD_PREVIEW_WIDTH = 1200;

function sizedCandidates(url: string | null | undefined) {
  return buildMediaPreviewCandidates(url, {
    width: MATERIAL_CARD_PREVIEW_WIDTH, height: MATERIAL_CARD_PREVIEW_WIDTH, mode: "cover",
  }).map(value => buildMediaProxyUrl(value) || value);
}

// Shared by entry preloading, cards and the offline cache backfill. They must
// request the same URL for the browser and server caches to be useful.
export function materialCardImageCandidates(item: MaterialCardPreviewSource) {
  const width = item.mediaItems?.[0]?.width || 0;
  const prepared = item.thumbnailUrl && (width >= MATERIAL_CARD_PREVIEW_WIDTH
    || /-card-1200\.webp(?:[?#]|$)/i.test(item.thumbnailUrl));
  const thumbnail = prepared ? [buildMediaProxyUrl(item.thumbnailUrl) || item.thumbnailUrl!] : [];
  return Array.from(new Set([
    ...thumbnail, ...sizedCandidates(item.imageUrl),
    ...[item.previewUrl, item.imageUrl, item.thumbnailUrl].flatMap(sizedCandidates),
  ].filter(Boolean)));
}

export function materialCardVideoPosterCandidates(item: MaterialCardPreviewSource) {
  return Array.from(new Set([item.thumbnailUrl, item.previewUrl]
    .filter((url): url is string => Boolean(url && url !== item.imageUrl && !isVideoMediaUrl(url)))
    .flatMap(sizedCandidates)));
}
