import "server-only";

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  normalizeRoleSkillFeatureKeys,
  ROLE_SKILL_FEATURES,
  type RoleSkillFeatureKey,
} from "@/lib/role-skills/features";

type FeatureBindingClient = Pick<Prisma.TransactionClient, "appSetting">;

function settingKey(featureKey: RoleSkillFeatureKey) {
  return `role_skill_binding.${featureKey}`;
}

export async function getRoleSkillFeatureBinding(
  featureKey: RoleSkillFeatureKey,
  client: FeatureBindingClient = prisma,
): Promise<string | null> {
  const row = await client.appSetting.findUnique({
    where: { key: settingKey(featureKey) },
  });
  if (!row?.value) return null;
  try {
    const value = JSON.parse(row.value) as {
      version?: unknown;
      skillPublicId?: unknown;
    };
    if (value.version !== 1) return null;
    const publicId = String(value.skillPublicId || "").trim();
    return /^system:[1-9]\d*$/.test(publicId) ? publicId : null;
  } catch {
    return null;
  }
}

export async function getRoleSkillFeatureKeysForSkill(
  skillPublicId: string,
  client: FeatureBindingClient = prisma,
): Promise<RoleSkillFeatureKey[]> {
  const bindings = await Promise.all(ROLE_SKILL_FEATURES.map(async (feature) => ({
    key: feature.key,
    skillPublicId: await getRoleSkillFeatureBinding(feature.key, client),
  })));
  return bindings
    .filter((binding) => binding.skillPublicId === skillPublicId)
    .map((binding) => binding.key);
}

export async function saveRoleSkillFeatureBindings(
  skillPublicId: string,
  featureKeys: unknown,
  client: FeatureBindingClient = prisma,
): Promise<void> {
  const selected = new Set(normalizeRoleSkillFeatureKeys(featureKeys));
  for (const feature of ROLE_SKILL_FEATURES) {
    const key = settingKey(feature.key);
    if (selected.has(feature.key)) {
      const value = JSON.stringify({ version: 1, skillPublicId });
      await client.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      continue;
    }
    const current = await getRoleSkillFeatureBinding(feature.key, client);
    if (current === skillPublicId) {
      await client.appSetting.deleteMany({ where: { key } });
    }
  }
}
