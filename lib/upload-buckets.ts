export const PRODUCT_LIBRARY_ROOT = "products";
export const MATERIAL_LIBRARY_ROOT = "material_library";
export const AGENT_IMPORTS_FOLDER = "Agent_imports";
export const AGENT_IMAGE_RESULTS_FOLDER = "Agent_image_results";
export const AGENT_VIDEO_RESULTS_FOLDER = "Agent_video_results";
export const AGENT_AUDIO_RESULTS_FOLDER = "Agent_audio_results";

export const LEGACY_PRODUCT_LIBRARY_ROOT = "materials";
export const LEGACY_PRODUCT_LIBRARY_COMPAT_ROOT = "product-library";
export const LEGACY_MATERIAL_ASSET_ROOT = "materials/assets";

export function productLibrarySharedFolder(kind: string) {
  return `${PRODUCT_LIBRARY_ROOT}/shared/${kind}`;
}

export function productLibraryPrivateFolder(usernameFolder: string, kind: string) {
  return `${PRODUCT_LIBRARY_ROOT}/private/user_${usernameFolder}/${kind}`;
}

export function mediaLibraryPrivateFolderForSource(source: string, usernameFolder: string, kind: string) {
  return source === "agent"
    ? AGENT_IMPORTS_FOLDER
    : productLibraryPrivateFolder(usernameFolder, kind);
}

export function isAgentImportMediaRef(value: unknown) {
  let ref = String(value || "").trim().replaceAll("\\", "/");
  if (!ref) return false;
  try {
    ref = new URL(ref).pathname;
  } catch {}
  if (ref.startsWith("uploads/")) ref = `/${ref}`;
  return ref.split(/[?#]/, 1)[0].startsWith(`/uploads/${AGENT_IMPORTS_FOLDER}/`);
}

export const PRODUCT_LIBRARY_THUMBNAILS_FOLDER = `${PRODUCT_LIBRARY_ROOT}/thumbs/generated`;
export const PRODUCT_LIBRARY_PREVIEWS_FOLDER = `${PRODUCT_LIBRARY_ROOT}/previews/generated`;
export const PRODUCT_LIBRARY_POSTERS_FOLDER = `${PRODUCT_LIBRARY_ROOT}/posters/generated`;

export const MATERIAL_ASSET_ORIGINALS_FOLDER = `${MATERIAL_LIBRARY_ROOT}/originals`;
export const MATERIAL_ASSET_THUMBNAILS_FOLDER = `${MATERIAL_LIBRARY_ROOT}/thumbs`;
export const MATERIAL_ASSET_PREVIEWS_FOLDER = `${MATERIAL_LIBRARY_ROOT}/previews`;
export const MATERIAL_ASSET_POSTERS_FOLDER = `${MATERIAL_LIBRARY_ROOT}/posters`;
export const GENERATION_PREVIEWS_FOLDER = "generation_previews";
export const GENERATION_POSTERS_FOLDER = "generation_posters";
export const ROLE_SKILL_COVERS_ROOT = "role_skill_covers";
export const ROLE_SKILL_SYSTEM_COVERS_FOLDER = `${ROLE_SKILL_COVERS_ROOT}/system`;

export function roleSkillUserCoversFolder(authUserId: number) {
  return `${ROLE_SKILL_COVERS_ROOT}/users/${authUserId}`;
}

export function roleSkillSystemWorkspaceFolder(skillId: bigint) {
  return `${ROLE_SKILL_SYSTEM_COVERS_FOLDER}/workspaces/${skillId}`;
}

export function roleSkillUserWorkspaceFolder(authUserId: number, skillId: bigint) {
  return `${roleSkillUserCoversFolder(authUserId)}/workspaces/${skillId}`;
}

export const PROTECTED_UPLOAD_ROOTS = [
  `/uploads/${PRODUCT_LIBRARY_ROOT}/`,
  `/uploads/${MATERIAL_LIBRARY_ROOT}/`,
  `/uploads/${LEGACY_PRODUCT_LIBRARY_ROOT}/`,
  `/uploads/${LEGACY_PRODUCT_LIBRARY_COMPAT_ROOT}/`,
];

export const PROTECTED_OSS_ROOTS = [
  `uploads/${PRODUCT_LIBRARY_ROOT}/`,
  `uploads/${MATERIAL_LIBRARY_ROOT}/`,
  `uploads/${LEGACY_PRODUCT_LIBRARY_ROOT}/`,
  `uploads/${LEGACY_PRODUCT_LIBRARY_COMPAT_ROOT}/`,
];
