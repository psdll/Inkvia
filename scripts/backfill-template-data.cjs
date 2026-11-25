const { createGuardedPrismaClient } = require("./lib/runtime-isolation.cjs");
const { PrismaClient } = require("@prisma/client");

const prisma = createGuardedPrismaClient();
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 100);

function parseJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeMetadataList(logs) {
  const merged = new Map();
  for (const log of logs) {
    if (!log.generationId) continue;
    const parsed = parseJson(log.metadata);
    if (!parsed) continue;
    const prev = merged.get(log.generationId) || {};
    const next = { ...prev, ...parsed };
    if (log.action === "task_success" && Object.prototype.hasOwnProperty.call(prev, "duration")) {
      next.duration = prev.duration;
    }
    merged.set(log.generationId, next);
  }
  return merged;
}

async function main() {
  let updated = 0;
  let scanned = 0;
  let lastId = 0;

  for (;;) {
    const rows = await prisma.generation.findMany({
      where: { templateData: null, id: { gt: lastId } },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      select: { id: true, userId: true, authUserId: true }
    });

    if (!rows.length) break;
    scanned += rows.length;
    lastId = rows[rows.length - 1].id;

    const ids = rows.map((row) => row.id);
    const userIds = Array.from(new Set(rows.map((row) => String(row.authUserId || row.userId || "")).filter(Boolean)));
    const logs = await prisma.log.findMany({
      where: {
        generationId: { in: ids },
        category: "generation",
        action: { in: ["task_create", "task_success"] },
        metadata: { not: null },
        ...(userIds.length ? { userId: { in: userIds } } : {})
      },
      orderBy: { createdAt: "asc" },
      select: { generationId: true, action: true, metadata: true }
    });

    const paramsById = mergeMetadataList(logs);
    for (const row of rows) {
      const params = paramsById.get(row.id);
      if (!params || !Object.keys(params).length) continue;
      await prisma.generation.update({
        where: { id: row.id },
        data: { templateData: JSON.stringify(params) }
      });
      updated += 1;
    }

    console.log(`scanned=${scanned} updated=${updated}`);
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`done scanned=${scanned} updated=${updated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
