#!/usr/bin/env node
import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
// scripts/backfill-generation-sizes.mjs
//
// 一次性 / 可重跑的回填脚本: 对每个 Generation.localPath fs.stat 一次,
// 把磁盘文件大小写到 Generation.sizeBytes。完成后 admin/用户详情页的
// "已用空间"和系统概览的"用户磁盘占比"才会反映真实值。
//
// 用法:  node scripts/backfill-generation-sizes.mjs
//        node scripts/backfill-generation-sizes.mjs --dry-run
//        node scripts/backfill-generation-sizes.mjs --force        # 即便已有 sizeBytes 也覆盖
//
// 设计要点:
//   * 默认跳过 sizeBytes 已有值的行(幂等可重跑)
//   * 用 LIMIT + OFFSET 分批扫,避免一次拉几万行进内存
//   * 单次进程退出不破坏: 跑到哪算哪,下次继续

import { PrismaClient } from "@prisma/client";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = createGuardedPrismaClient();
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FORCE = args.has("--force");
const BATCH = 500;

function getUploadsRoot() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, "..", "public", "uploads");
}

function toDiskPath(uploadsRoot, localPath) {
  const p = String(localPath || "").trim();
  if (!p.startsWith("/uploads/")) return null;
  return path.join(uploadsRoot, p.replace(/^\/uploads\//, ""));
}

async function main() {
  const uploadsRoot = getUploadsRoot();
  console.log(`[backfill] uploads root: ${uploadsRoot}`);
  console.log(`[backfill] mode: ${DRY_RUN ? "DRY RUN" : "WRITE"}${FORCE ? " (force overwrite)" : ""}`);

  const baseWhere = FORCE
    ? { localPath: { not: null } }
    : { localPath: { not: null }, sizeBytes: null };

  const total = await prisma.generation.count({ where: baseWhere });
  console.log(`[backfill] candidate rows: ${total}`);
  if (total === 0) {
    console.log("[backfill] nothing to do.");
    return;
  }

  let cursor = 0;
  let scanned = 0;
  let updated = 0;
  let missingFiles = 0;
  const startedAt = Date.now();

  while (cursor < total) {
    const rows = await prisma.generation.findMany({
      where: baseWhere,
      orderBy: { id: "asc" },
      take: BATCH,
      skip: cursor,
      select: { id: true, localPath: true },
    });
    if (!rows.length) break;

    for (const row of rows) {
      scanned += 1;
      const disk = toDiskPath(uploadsRoot, row.localPath);
      if (!disk) continue;
      const st = await fs.stat(disk).catch(() => null);
      if (!st || !st.isFile()) {
        missingFiles += 1;
        continue;
      }
      const size = Number(st.size || 0);
      if (!Number.isFinite(size) || size <= 0) continue;

      if (DRY_RUN) {
        updated += 1;
        continue;
      }

      await prisma.generation
        .update({ where: { id: row.id }, data: { sizeBytes: size } })
        .then(() => {
          updated += 1;
        })
        .catch((err) => {
          console.warn(`[backfill] update id=${row.id} failed:`, err?.message || err);
        });
    }
    cursor += rows.length;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[backfill] scanned=${scanned}/${total} updated=${updated} missingFiles=${missingFiles} elapsed=${elapsed}s`,
    );
  }

  console.log(
    `[backfill] done. scanned=${scanned} updated=${updated} missingFiles=${missingFiles} duration=${(
      (Date.now() - startedAt) /
      1000
    ).toFixed(1)}s`,
  );
}

main()
  .catch((err) => {
    console.error("[backfill] fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
