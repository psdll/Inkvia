import { parseMediaLibraryTags, stringifyMediaLibraryTags } from "@/lib/media-library";

export const MATERIAL_ASSET_UNCATEGORIZED = "__uncategorized__";
export const DEFAULT_MATERIAL_ASSET_CATEGORIES = ["按摩椅", "净化器", "美容仪"];

export function normalizeMaterialAssetCategory(raw: unknown) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 80) : null;
}

export function isUncategorizedMaterialAssetCategory(raw: unknown) {
  return String(raw || "").trim() === MATERIAL_ASSET_UNCATEGORIZED;
}

export function buildMaterialAssetTitle(rawTitle: unknown, fallbackName: string, index = 0) {
  const text = String(rawTitle || "").trim();
  if (text) return text.slice(0, 120);
  const fallback = String(fallbackName || "").trim();
  if (fallback) return fallback.slice(0, 120);
  return `素材_${index || Date.now()}`;
}

export function parseMaterialAssetTags(raw: unknown) {
  return parseMediaLibraryTags(raw);
}

export function stringifyMaterialAssetTags(tags: string[]) {
  return stringifyMediaLibraryTags(tags);
}

export function parseStoredMaterialAssetTags(raw: unknown) {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parseMaterialAssetTags(parsed) : [];
  } catch {
    return [];
  }
}
