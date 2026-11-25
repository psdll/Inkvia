export const PERSONAL_LIBRARY_DEFAULTS = ["产品", "角色", "场景", "道具", "风格", "音效", "其他"] as const;
export type PersonalFolder = { id: string; name: string; parentId: string | null };
export type PersonalMaterial = {
  id: string; name: string; folderId: string | null; fileName: string;
  kind: "image" | "video" | "audio"; mime: string; size: number; createdAt: string;
};
export type PersonalLibrary = { version: 1; folders: PersonalFolder[]; items: PersonalMaterial[] };
export const personalMaterialUrl = (id: string) => `/api/canvas/materials/${encodeURIComponent(id)}/file`;
export const personalMaterialPreviewUrl = (id: string, ownerId: number, width: 120 | 600 = 120) => `${personalMaterialUrl(id)}?preview=${width}&owner=${ownerId}`;
export function personalMaterialDownloadName(item: PersonalMaterial) {
  const extension = item.fileName.slice(item.fileName.lastIndexOf("."));
  return item.name.toLowerCase().endsWith(extension.toLowerCase()) ? item.name : item.name + extension;
}
