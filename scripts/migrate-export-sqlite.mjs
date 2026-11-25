import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
// 迁移第 1 步：把当前 SQLite 数据库的全部数据导出为 JSON。
// 必须在 schema.prisma 仍为 sqlite 时运行（此时 Prisma client 连接 SQLite）。
//
// 用法：node scripts/migrate-export-sqlite.mjs

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = createGuardedPrismaClient();

// 顺序无关（导出阶段）；导入阶段会按外键依赖重新排序
const MODELS = [
  "whitelistName",
  "user",
  "generation",
  "template",
  "tag",
  "templateTag",
  "log",
  "appSetting",
  "trendingTopic",
  "mediaLibraryItem",
];

const OUT = path.join(process.cwd(), "prisma", "_migration-dump.json");

async function main() {
  const dump = {};
  const counts = {};
  for (const model of MODELS) {
    const rows = await prisma[model].findMany();
    dump[model] = rows;
    counts[model] = rows.length;
    console.log(`  ${model}: ${rows.length} 行`);
  }
  fs.writeFileSync(OUT, JSON.stringify(dump), "utf8");
  fs.writeFileSync(
    OUT.replace(/\.json$/, ".counts.json"),
    JSON.stringify(counts, null, 2),
    "utf8"
  );
  console.log(`\n✓ 已导出到 ${OUT}`);
  console.log(`  总行数: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
}

main()
  .catch((e) => {
    console.error("导出失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
