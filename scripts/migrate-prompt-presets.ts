import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  createPromptPresetMigrationService,
  scanLegacyPromptPresets,
} from "@/lib/prompt-presets/migration";
import {
  createCanvasPromptSeedService,
  scanCanvasPromptSeeds,
} from "@/lib/prompt-presets/builtin-seeds";
import { resolveProjectRootDir, resolvePublicDir } from "@/lib/public-path";

type UserScan = {
  authUserId: number;
  directory: string;
  scan: Awaited<ReturnType<typeof scanLegacyPromptPresets>>;
};

function selectedMode() {
  const dryRun = process.argv.includes("--dry-run");
  const apply = process.argv.includes("--apply");
  if (dryRun === apply) {
    throw new Error("必须且只能指定 --dry-run 或 --apply");
  }
  return apply ? "apply" : "dry-run";
}

function printable(values: string[]) {
  return values.length ? values.join(", ") : "无";
}

async function scanUserDirectories(publicDir: string) {
  const root = path.join(publicDir, "uploads", "presets");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const directories = entries
    .filter((entry) => entry.isDirectory() && entry.name !== "_builtin")
    .sort((a, b) => a.name.localeCompare(b.name));
  const skippedGuestDirectories: string[] = [];
  const users: UserScan[] = [];

  for (const entry of directories) {
    if (!/^[1-9]\d*$/.test(entry.name)) {
      skippedGuestDirectories.push(entry.name);
      continue;
    }
    const authUserId = Number(entry.name);
    if (!Number.isSafeInteger(authUserId)) {
      skippedGuestDirectories.push(entry.name);
      continue;
    }
    users.push({
      authUserId,
      directory: entry.name,
      scan: await scanLegacyPromptPresets({
        publicDir,
        presetUserIds: [entry.name],
      }),
    });
  }

  return { directoryCount: directories.length, skippedGuestDirectories, users };
}

async function main() {
  const mode = selectedMode();
  const publicDir = resolvePublicDir();
  const canvasSeedPath = path.join(
    resolveProjectRootDir(),
    "config",
    "prompt-presets",
    "canvas-v1.json",
  );
  const userSources = await scanUserDirectories(publicDir);
  const builtinScan = await scanLegacyPromptPresets({
    publicDir,
    presetUserIds: ["_builtin"],
  });
  const canvasScan = await scanCanvasPromptSeeds(canvasSeedPath);
  const userScopeFiles = userSources.users.reduce(
    (total, user) => total + user.scan.fileCount,
    0,
  );
  const userValid = userSources.users.reduce(
    (total, user) => total + user.scan.validCount,
    0,
  );
  const userInvalid = userSources.users.reduce(
    (total, user) => total + user.scan.invalidCount,
    0,
  );

  console.log(`模式: ${mode}`);
  console.log(
    `用户目录: ${userSources.directoryCount}（可归属 ${userSources.users.length}，跳过 guest ${userSources.skippedGuestDirectories.length}）`,
  );
  console.log(`用户 scope 文件: ${userScopeFiles}`);
  console.log(`用户记录: 合法 ${userValid}，非法 ${userInvalid}`);
  console.log(
    `旧内置: scope 文件 ${builtinScan.fileCount}，合法 ${builtinScan.validCount}，非法 ${builtinScan.invalidCount}`,
  );
  console.log(`画布规范化种子: ${canvasScan.presets.length}`);
  console.log(
    `预计写入: 用户自定义 ${userValid}，全局旧内置 ${builtinScan.validCount}，画布内置 ${canvasScan.presets.length}`,
  );
  for (const user of userSources.users) {
    console.log(
      `用户 ${user.authUserId}: version=${user.scan.version} digest=${user.scan.digest} 重复旧 ID=${printable(user.scan.duplicateIds)} 重复名称=${printable(user.scan.duplicateNames)}`,
    );
  }
  console.log(
    `旧内置: version=${builtinScan.version} digest=${builtinScan.digest} 重复旧 ID=${printable(builtinScan.duplicateIds)} 重复名称=${printable(builtinScan.duplicateNames)}`,
  );
  console.log(
    `画布: version=${canvasScan.version} digest=${canvasScan.digest}`,
  );
  for (const directory of userSources.skippedGuestDirectories) {
    console.log(`跳过非数字 guest 目录: ${directory}（无法可靠归属 authUserId）`);
  }

  if (mode === "dry-run") {
    console.log("dry-run 完成：未写入数据库，未修改源文件。");
    return;
  }

  const prisma = createGuardedPrismaClient();
  try {
    const migration = createPromptPresetMigrationService({ prisma, publicDir });
    const canvasSeeds = createCanvasPromptSeedService({
      prisma,
      seedPath: canvasSeedPath,
    });
    let importedUsers = 0;
    for (const user of userSources.users) {
      const result = await migration.ensureLegacyUserPromptsMigrated({
        authUserId: user.authUserId,
        presetUserIds: [user.directory],
      });
      importedUsers += result.imported;
    }
    const builtins = await migration.ensureLegacyBuiltinPromptsMigrated();
    const canvas = await canvasSeeds.ensureCanvasPromptSeeds();
    console.log(
      `apply 完成：用户自定义 ${importedUsers}，全局旧内置 ${builtins.imported}，画布内置 ${canvas.imported}。`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
