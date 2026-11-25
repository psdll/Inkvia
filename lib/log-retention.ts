import prisma from "@/lib/prisma";
import { computeDeletableRefsForGenerationIds, deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { retentionCutoffWhere } from "@/lib/data-retention";
import { deleteGenerationRowsAndBatchCards } from "@/lib/generation-physical-delete";
import { enqueueMediaCleanupRetry, enqueueMediaCleanupRetryIfNeeded } from "@/lib/media-cleanup-retry";

let lastPruneAt = 0;
let inFlight: Promise<void> | null = null;
const KEY_RETENTION_DAYS = "data_retention_days";
const KEY_LAST_PRUNED_AT = "data_retention_last_pruned_at";
const DAY_MS = 24 * 60 * 60 * 1000;

export type LogRetentionPolicy = {
  normalDays: number;
  errorDays: number;
  auditDays: number;
};

type LogRetentionPolicyInput = {
  normalDays?: unknown;
  errorDays?: unknown;
  auditDays?: unknown;
};

function positiveDays(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function normalizeLogRetentionPolicy(input: LogRetentionPolicyInput): LogRetentionPolicy {
  const normalDays = positiveDays(input.normalDays, 15);
  const errorDays = Math.max(normalDays, positiveDays(input.errorDays, 30));
  const auditDays = Math.max(errorDays, positiveDays(input.auditDays, 180));
  return { normalDays, errorDays, auditDays };
}

export function logRetentionPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): LogRetentionPolicy {
  return normalizeLogRetentionPolicy({
    normalDays: env.LOG_RETENTION_DAYS,
    errorDays: env.ERROR_LOG_RETENTION_DAYS,
    auditDays: env.AUDIT_LOG_RETENTION_DAYS,
  });
}

export function buildLogRetentionWhere(policy: LogRetentionPolicy, now = new Date()) {
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    OR: [
      {
        category: "admin",
        ...retentionCutoffWhere(cutoff(policy.auditDays)),
      },
      {
        category: { not: "admin" },
        level: "error",
        ...retentionCutoffWhere(cutoff(policy.errorDays)),
      },
      {
        category: { not: "admin" },
        level: { not: "error" },
        ...retentionCutoffWhere(cutoff(policy.normalDays)),
      },
    ],
  };
}

function envRetentionDays() {
  const raw = (process.env.DATA_RETENTION_DAYS || process.env.LOG_RETENTION_DAYS || "").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 15;
}

async function retentionDays() {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY_RETENTION_DAYS } });
    const n = Number(row?.value || "");
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  } catch {}
  return envRetentionDays();
}

export async function pruneGenerationsAndFiles(cutoff: Date) {
  const BATCH = 200;
  let deletedLogs = 0;
  let deletedGenerations = 0;
  let deletedLedgers = 0;
  let deletedFiles = 0;
  while (true) {
    const rows = await prisma.generation.findMany({
      where: retentionCutoffWhere(cutoff),
      orderBy: { createdAt: "asc" },
      take: BATCH,
      select: { id: true }
    });
    if (!rows.length) break;
    const ids = rows.map((x) => x.id);

    // 关键修复：只删未被本批以外的 generation 仍引用的资源，避免破图。
    const deletableRefs = await computeDeletableRefsForGenerationIds(ids);

    const databaseDeletion = await prisma.$transaction(async (tx) => {
      const logsDeleted = await tx.log.deleteMany({ where: { generationId: { in: ids } } });
      // 费用账本独立保留；Generation 外键删除时置空，作品清理不改变历史账单。
      const ledgersDeleted = { count: 0 };
      const generationsDeleted = await deleteGenerationRowsAndBatchCards(tx, ids);
      return {
        logs: Number(logsDeleted.count || 0),
        ledgers: Number(ledgersDeleted.count || 0),
        generations: generationsDeleted.generations,
        generationOutputMediaIds: generationsDeleted.generationOutputMediaIds,
      };
    });
    deletedLogs += databaseDeletion.logs;
    deletedLedgers += databaseDeletion.ledgers;
    deletedGenerations += databaseDeletion.generations;

    if (deletableRefs.length > 0) {
      try {
        const deletion = await deleteStoredMediaRefs(deletableRefs, {
          canonicalGenerationOutputs: true,
          canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
        });
        await enqueueMediaCleanupRetryIfNeeded(deletableRefs, deletion, {
          source: "automatic_retention",
          generationIds: ids,
          canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
        });
        deletedFiles += Number(deletion.deletedLocalFiles || 0) + Number(deletion.deletedOssObjects || 0);
      } catch (error) {
        await enqueueMediaCleanupRetry(deletableRefs, {
          source: "automatic_retention",
          generationIds: ids,
          canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
          error: String((error as Error)?.message || error),
        }).catch(() => null);
      }
    }
  }
  return { deletedLogs, deletedGenerations, deletedLedgers, deletedFiles };
}

async function runPrune() {
  const now = Date.now();
  const days = await retentionDays();
  const cutoff = new Date(now - days * DAY_MS);
  await pruneGenerationsAndFiles(cutoff);
  const logPolicy = logRetentionPolicyFromEnv();
  await prisma.log.deleteMany({
    where: {
      generationId: null,
      ...buildLogRetentionWhere(logPolicy, new Date(now)),
    },
  });
  const prunedAt = new Date(now).toISOString();
  await prisma.appSetting
    .upsert({
      where: { key: KEY_LAST_PRUNED_AT },
      create: { key: KEY_LAST_PRUNED_AT, value: prunedAt },
      update: { value: prunedAt },
    })
    .catch(() => null);
}

export async function pruneLogsIfNeeded() {
  const now = Date.now();
  if (now - lastPruneAt < 6 * 60 * 60 * 1000) return;
  if (inFlight) return inFlight;
  lastPruneAt = now;
  inFlight = runPrune().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
