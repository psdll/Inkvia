import { isDesktopMode } from "@/lib/desktop-mode";
import prisma from "@/lib/prisma";

const KEY_PREFIX = "material_upload_allowed:";

function normalizeUsername(username: unknown) {
  return String(username || "").trim();
}

function keyForUsername(username: string) {
  return `${KEY_PREFIX}${username}`;
}

export async function getMaterialUploadAllowedUsernames(usernames: string[]) {
  const normalized = Array.from(new Set(usernames.map(normalizeUsername).filter(Boolean)));
  if (!normalized.length) return new Set<string>();

  const rows = await prisma.appSetting
    .findMany({
      where: { key: { in: normalized.map(keyForUsername) } },
      select: { key: true, value: true },
    })
    .catch(() => [] as { key: string; value: string }[]);

  const allowed = new Set<string>();
  for (const row of rows) {
    if (String(row.value || "") !== "1") continue;
    const username = String(row.key || "").slice(KEY_PREFIX.length);
    if (username) allowed.add(username);
  }
  return allowed;
}

export async function isMaterialUploadAllowed(username: unknown) {
  const normalized = normalizeUsername(username);
  if (!normalized) return false;
  if (isDesktopMode()) return true;
  const allowed = await getMaterialUploadAllowedUsernames([normalized]);
  return allowed.has(normalized);
}

export async function setMaterialUploadAllowed(username: unknown, allowed: boolean) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error("username is required");
  const key = keyForUsername(normalized);
  if (!allowed) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: "1" },
    update: { value: "1" },
  });
}
