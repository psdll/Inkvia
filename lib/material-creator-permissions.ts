import prisma from "@/lib/prisma";

export const MATERIAL_CREATOR_INSPIRATION_ENABLED_KEY = "material_creator_inspiration_enabled";

export function normalizeCreatorPermissionName(value: unknown) {
  return String(value || "").trim();
}

export function uniqueCreatorPermissionNames(values: unknown[]) {
  return Array.from(
    new Set(values.map(normalizeCreatorPermissionName).filter(Boolean))
  );
}

export async function getEnabledMaterialCreatorNames() {
  const row = await prisma.appSetting.findUnique({
    where: { key: MATERIAL_CREATOR_INSPIRATION_ENABLED_KEY },
  });
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(uniqueCreatorPermissionNames(parsed));
  } catch {
    return new Set<string>();
  }
}

export async function setEnabledMaterialCreatorNames(names: string[]) {
  const enabledNames = uniqueCreatorPermissionNames(names);
  await prisma.appSetting.upsert({
    where: { key: MATERIAL_CREATOR_INSPIRATION_ENABLED_KEY },
    create: {
      key: MATERIAL_CREATOR_INSPIRATION_ENABLED_KEY,
      value: JSON.stringify(enabledNames),
    },
    update: { value: JSON.stringify(enabledNames) },
  });
  return enabledNames;
}

export async function isMaterialCreatorInspirationEnabled(username: unknown) {
  const name = normalizeCreatorPermissionName(username);
  if (!name) return false;

  const enabledNames = await getEnabledMaterialCreatorNames();
  return enabledNames === null || enabledNames.has(name);
}
