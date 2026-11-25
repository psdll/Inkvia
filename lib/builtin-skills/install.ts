import "server-only";

import { rm } from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { assertWritablePath } from "@/lib/runtime-isolation";
import catalog from "./catalog.json";

type SkillStore = Pick<PrismaClient, "$transaction" | "appSetting" | "systemRoleSkill">;
const liveVideoBinding = "role_skill_binding.batch_workbench.live_video";
const coverMigrationKey = "desktop.seed.live_photo_skill.cover_removed.v1";
const legacyCoverPath = "role_skill_covers/system/525b4816-aad1-4794-a954-db8d0e8abdb4.webp";
const legacyCoverUrl = "/uploads/" + legacyCoverPath;

async function markOnce(tx: Prisma.TransactionClient, key: string, value = "1") {
  const result = await tx.appSetting.createMany({ data: { key, value }, skipDuplicates: true });
  return result.count > 0;
}

async function installSkill(tx: Prisma.TransactionClient, { key, ...skill }: typeof catalog.livePhoto) {
  // The claim and skill are committed together. Keep the marker after deletion or unbinding.
  if (!await markOnce(tx, key)) return false;
  const existing = await tx.systemRoleSkill.findFirst({
    where: { OR: [{ name: skill.name }, { content: skill.content }] },
    orderBy: { id: "asc" },
    select: { id: true, status: true, deletedAt: true },
  });
  const installed = existing ?? await tx.systemRoleSkill.create({
    data: { ...skill, status: "published", usageScenario: "", usageGuide: "" },
    select: { id: true, status: true, deletedAt: true },
  });
  if (key === catalog.livePhoto.key && installed.status === "published" && !installed.deletedAt) {
    await markOnce(tx, liveVideoBinding, JSON.stringify({ version: 1, skillPublicId: "system:" + installed.id }));
  }
  return true;
}

async function stageLegacyCoverRemoval(tx: Prisma.TransactionClient, livePhotoAlreadyInstalled: boolean) {
  if (!await markOnce(tx, coverMigrationKey, "done") || !livePhotoAlreadyInstalled) return;
  // The historical seed stored no ID. Only clear the known cover if it has one identifiable owner.
  const { livePhoto } = catalog;
  const matches = await tx.systemRoleSkill.findMany({
    where: { coverUrl: legacyCoverUrl, OR: [{ name: livePhoto.name }, { content: livePhoto.content }] },
    select: { id: true, updatedAt: true },
    take: 2,
  });
  if (matches.length !== 1) return;
  const [{ id, updatedAt }] = matches;
  const changed = await tx.systemRoleSkill.updateMany({
    where: { id, coverUrl: legacyCoverUrl },
    data: { coverUrl: null, updatedAt },
  });
  if (changed.count) {
    await tx.appSetting.update({ where: { key: coverMigrationKey }, data: { value: "cleanup_pending" } });
  }
}

export async function installBuiltinRoleSkills(db: SkillStore, desktopUploadsDir?: string) {
  await db.$transaction(async tx => {
    // Reuse the original desktop Live Photo marker on both runtimes.
    const installedLivePhoto = await installSkill(tx, catalog.livePhoto);
    await installSkill(tx, catalog.productScene);
    if (desktopUploadsDir) await stageLegacyCoverRemoval(tx, !installedLivePhoto);
  });
  if (!desktopUploadsDir) return;
  const cleanup = await db.appSetting.findUnique({ where: { key: coverMigrationKey }, select: { value: true } });
  if (cleanup?.value !== "cleanup_pending") return;
  // Commit the updated database reference first. An interrupted file cleanup can be retried.
  const referenced = await db.systemRoleSkill.findFirst({ where: { coverUrl: legacyCoverUrl }, select: { id: true } });
  if (!referenced) {
    const coverFile = path.join(desktopUploadsDir, legacyCoverPath);
    assertWritablePath(coverFile);
    await rm(coverFile, { force: true });
  }
  await db.appSetting.update({ where: { key: coverMigrationKey }, data: { value: "done" } });
}
