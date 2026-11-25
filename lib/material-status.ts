export type MaterialStatus = "all" | "available" | "selected" | "mine";
export const MATERIAL_STATUS_STORAGE_KEY = "materials_status_filter_v3";

export function normalizeMaterialStatus(value: string | null, fallback: MaterialStatus = "all"): MaterialStatus {
  if (value === "archived") return "mine";
  if (value === "available_archived") return "available";
  return value === "all" || value === "available" || value === "selected" || value === "mine" ? value : fallback;
}

export function readSavedMaterialStatus(): MaterialStatus {
  if (typeof window === "undefined") return "all";
  try {
    const saved = localStorage.getItem(MATERIAL_STATUS_STORAGE_KEY);
    if (saved) return normalizeMaterialStatus(saved);
  } catch {}
  return "all";
}
