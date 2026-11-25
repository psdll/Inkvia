import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
// 迁移第 2 步：把导出的 JSON 数据导入 PostgreSQL。
// 必须在 schema.prisma 已切换为 postgresql、且 prisma migrate 已建好表之后运行。
//
// 用法：node scripts/migrate-import-pg.mjs

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = createGuardedPrismaClient();
const DUMP = path.join(process.cwd(), "prisma", "_migration-dump.json");

// 按外键依赖排序：被依赖的表先插入
const IMPORT_ORDER = [
  "whitelistName",
  "user",
  "template",
  "tag",
  "generation",
  "templateTag",
  "log",
  "appSetting",
  "trendingTopic",
  "mediaLibraryItem",
];

// 自增主键表 → 物理表名（用于重置序列）
const SEQUENCE_TABLES = {
  whitelistName: "WhitelistName",
  user: "User",
  template: "Template",
  tag: "Tag",
  generation: "Generation",
  log: "Log",
  trendingTopic: "TrendingTopic",
  mediaLibraryItem: "MediaLibraryItem",
};

const BATCH = 500;

async function main() {
  if (!fs.existsSync(DUMP)) {
    throw new Error(`找不到导出文件 ${DUMP}，请先运行 migrate-export-sqlite.mjs`);
  }
  const dump = JSON.parse(fs.readFileSync(DUMP, "utf8"));
  if (Array.isArray(dump.user) && dump.user.length) throw new Error("LEGACY_ACCOUNT_IMPORT_DISABLED_USE_ADMIN_DATA_IMPORT");
  const result = {};

  for (const model of IMPORT_ORDER) {
    const rows = Array.isArray(dump[model]) ? dump[model] : [];
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const res = await prisma[model].createMany({ data: chunk, skipDuplicates: true });
      inserted += res.count;
    }
    result[model] = inserted;
    console.log(`  ${model}: 导入 ${inserted}/${rows.length}`);
  }

  // 重置自增序列，使后续 INSERT 不与已导入 ID 冲突
  console.log("\n重置自增序列...");
  for (const [model, table] of Object.entries(SEQUENCE_TABLES)) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
       GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1))`
    );
  }
  console.log("✓ 序列已重置");

  // 逐表核对行数
  console.log("\n核对行数:");
  let allMatch = true;
  for (const model of IMPORT_ORDER) {
    const expected = Array.isArray(dump[model]) ? dump[model].length : 0;
    const actual = await prisma[model].count();
    const ok = expected === actual;
    if (!ok) allMatch = false;
    console.log(`  ${model}: 期望 ${expected} / 实际 ${actual} ${ok ? "✓" : "✗ 不一致"}`);
  }
  if (!allMatch) {
    throw new Error("行数核对不一致，请检查");
  }
  console.log("\n✓ 全部表行数一致，迁移完成");
}

main()
  .catch((e) => {
    console.error("导入失败：请检查隔离环境及账号导入方式");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
