import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = createGuardedPrismaClient();
const apply = process.argv.includes("--apply");

async function readDuplicateGroups() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      "requestKey"::text AS "requestKey",
      COUNT(*)::bigint AS "rowCount",
      ARRAY_AGG("id" ORDER BY "id") AS "generationIds"
    FROM "Generation"
    WHERE "requestKey" IS NOT NULL
    GROUP BY "requestKey"
    HAVING COUNT(*) > 1
    ORDER BY MIN("id")
  `);
  return rows.map((row) => ({
    requestKey: String(row.requestKey),
    rowCount: Number(row.rowCount),
    generationIds: Array.isArray(row.generationIds) ? row.generationIds.map(Number) : [],
  }));
}

async function repairDuplicateKeys() {
  return prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT
        "id",
        ROW_NUMBER() OVER (PARTITION BY "requestKey" ORDER BY "id") AS "rowNumber"
      FROM "Generation"
      WHERE "requestKey" IS NOT NULL
    )
    UPDATE "Generation" AS generation
    SET "requestKey" = NULL
    FROM ranked
    WHERE generation."id" = ranked."id"
      AND ranked."rowNumber" > 1
  `);
}

async function main() {
  const before = await readDuplicateGroups();
  let updatedRows = 0;
  if (apply && before.length > 0) {
    updatedRows = await repairDuplicateKeys();
  }
  const after = apply ? await readDuplicateGroups() : before;

  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    duplicateGroups: before.length,
    duplicateRows: before.reduce((sum, group) => sum + group.rowCount, 0),
    rowsToRepair: before.reduce((sum, group) => sum + Math.max(0, group.rowCount - 1), 0),
    updatedRows,
    remainingDuplicateGroups: after.length,
    groups: before,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
