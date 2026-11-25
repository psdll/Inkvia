export const ROLE_SKILL_FEATURES = [
  {
    key: "batch_workbench.live_video",
    pageLabel: "批量",
    featureLabel: "批量生成视频用于 Live",
  },
] as const;

export type RoleSkillFeatureKey = (typeof ROLE_SKILL_FEATURES)[number]["key"];

export const LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY: RoleSkillFeatureKey =
  "batch_workbench.live_video";

export function normalizeRoleSkillFeatureKeys(value: unknown): RoleSkillFeatureKey[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<RoleSkillFeatureKey>(
    ROLE_SKILL_FEATURES.map((feature) => feature.key),
  );
  return Array.from(new Set(value.filter(
    (key): key is RoleSkillFeatureKey => allowed.has(key as RoleSkillFeatureKey),
  )));
}
