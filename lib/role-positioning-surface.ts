export const ROLE_POSITIONING_SURFACES = [
  "toolbox_image",
  "toolbox_video",
  "batch_workbench",
] as const;

export type RolePositioningSurface =
  (typeof ROLE_POSITIONING_SURFACES)[number];

export function parseRolePositioningSurface(
  value: unknown,
  fallback: RolePositioningSurface | null = null,
): RolePositioningSurface | null {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  return ROLE_POSITIONING_SURFACES.includes(
    normalized as RolePositioningSurface,
  )
    ? (normalized as RolePositioningSurface)
    : null;
}
