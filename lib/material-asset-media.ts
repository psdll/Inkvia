import { randomUUID } from "crypto";

export const MAX_MATERIAL_ASSET_GROUP_MEDIA = 15;

export type MaterialAssetMediaItem = {
  id: string;
  originalUrl: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  mime: string | null;
  size: number | null;
  width?: number | null;
  height?: number | null;
};

function cleanString(raw: unknown, max = 2000) {
  const value = String(raw || "").trim();
  return value ? value.slice(0, max) : "";
}

function cleanSize(raw: unknown) {
  const n = Math.floor(Number(raw || 0));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function createMaterialAssetMediaId() {
  return randomUUID();
}

export function normalizeMaterialAssetMediaItem(raw: unknown, fallbackId?: string): MaterialAssetMediaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const originalUrl = cleanString(obj.originalUrl ?? obj.imageUrl ?? obj.url);
  if (!originalUrl) return null;
  return {
    id: cleanString(obj.id, 120) || fallbackId || createMaterialAssetMediaId(),
    originalUrl,
    thumbnailUrl: cleanString(obj.thumbnailUrl) || null,
    previewUrl: cleanString(obj.previewUrl) || null,
    mime: cleanString(obj.mime ?? obj.mimeType, 160) || null,
    size: cleanSize(obj.size ?? obj.sizeBytes),
    ...(cleanSize(obj.width) && cleanSize(obj.height) ? { width: cleanSize(obj.width), height: cleanSize(obj.height) } : {}),
  };
}

export function fallbackMaterialAssetMedia(asset: any): MaterialAssetMediaItem[] {
  const originalUrl = cleanString(asset?.imageUrl);
  if (!originalUrl) return [];
  return [
    {
      id: cleanString(asset?.id ? `legacy_${asset.id}` : "") || createMaterialAssetMediaId(),
      originalUrl,
      thumbnailUrl: cleanString(asset?.thumbnailUrl) || null,
      previewUrl: cleanString(asset?.previewUrl) || null,
      mime: cleanString(asset?.mimeType, 160) || null,
      size: cleanSize(asset?.sizeBytes),
    },
  ];
}

export function parseMaterialAssetMedia(raw: unknown, fallbackAsset?: any): MaterialAssetMediaItem[] {
  const parsed = Array.isArray(raw) ? raw : [];
  const items = parsed
    .map((item, index) => normalizeMaterialAssetMediaItem(item, index === 0 && fallbackAsset?.id ? `legacy_${fallbackAsset.id}` : undefined))
    .filter((item): item is MaterialAssetMediaItem => Boolean(item));
  return items.length ? items : fallbackMaterialAssetMedia(fallbackAsset);
}

export function materialAssetMediaRefs(items: MaterialAssetMediaItem[]) {
  return items.flatMap((item) => [item.originalUrl, item.thumbnailUrl, item.previewUrl].filter((url): url is string => Boolean(url)));
}

export function materialAssetAllMediaRefs(asset: any) {
  const items = parseMaterialAssetMedia(asset?.media, asset);
  return [
    asset?.imageUrl,
    asset?.thumbnailUrl,
    asset?.previewUrl,
    ...materialAssetMediaRefs(items),
  ].filter((url): url is string => Boolean(url));
}

export function materialAssetCoverPatch(items: MaterialAssetMediaItem[]) {
  const cover = items[0];
  if (!cover) throw new Error("素材至少需要 1 张图片");
  return {
    imageUrl: cover.originalUrl,
    thumbnailUrl: cover.thumbnailUrl || cover.originalUrl,
    previewUrl: cover.previewUrl || cover.thumbnailUrl || cover.originalUrl,
    mimeType: cover.mime,
    sizeBytes: cover.size || 0,
    media: items as any,
    mediaCount: items.length,
  };
}

export function findMaterialAssetMedia(items: MaterialAssetMediaItem[], mediaId: unknown) {
  const id = cleanString(mediaId, 120);
  if (!id) return null;
  return items.find((item) => item.id === id) || null;
}

export function materialAssetDownloadUrls(asset: any) {
  return parseMaterialAssetMedia(asset?.media, asset).map((item) => item.originalUrl).filter(Boolean);
}

export function selectedMediaSnapshot(asset: any, mediaId: unknown) {
  const item = findMaterialAssetMedia(parseMaterialAssetMedia(asset?.media, asset), mediaId);
  return {
    selectedMediaId: item?.id || null,
    selectedMediaUrl: item?.originalUrl || null,
  };
}

export function reorderMaterialAssetMedia(items: MaterialAssetMediaItem[], coverIndex: number) {
  if (!items.length) return items;
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(Number(coverIndex) || 0)));
  if (index === 0) return items;
  const next = [...items];
  const [cover] = next.splice(index, 1);
  return [cover, ...next];
}
