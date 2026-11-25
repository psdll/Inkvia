import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { upsertAdminAssetFeedForRows } from "@/lib/admin-asset-feed";
import { runGenerationCompletionCreate } from "@/lib/maintenance";

export const GENERATION_CLAIM_HEARTBEAT_MS = 30_000;

export type GenerationClaimLease = {
  id: number;
  token: string;
  revision: Date;
  tail: Promise<void>;
  lostError: Error | null;
};

export class GenerationClaimLostError extends Error {
  constructor(message = "Generation finalization claim lost") {
    super(message);
    this.name = "GenerationClaimLostError";
  }
}

export function parseGenerationTemplateData(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function createGenerationClaimTemplateData(raw: string | null | undefined, token = randomUUID()) {
  const parsed = parseGenerationTemplateData(raw);
  const finalize = parsed.finalize && typeof parsed.finalize === "object" ? parsed.finalize : {};
  const claimedAt = new Date().toISOString();
  return {
    token,
    templateData: JSON.stringify({
      ...parsed,
      finalize: { ...finalize, claimToken: token, claimedAt },
    }),
  };
}

export function createGenerationClaimLease(id: number, token: string, revision: Date): GenerationClaimLease {
  return { id, token, revision, tail: Promise.resolve(), lostError: null };
}

export function generationClaimTokenNeedle(token: string) {
  return `"claimToken":${JSON.stringify(token)}`;
}

export function generationClaimOwnerWhere(lease: GenerationClaimLease, revision = lease.revision) {
  return {
    id: lease.id,
    localPath: null,
    status: "processing",
    updatedAt: revision,
    templateData: { contains: generationClaimTokenNeedle(lease.token) },
  } as const;
}

export function ownsGenerationClaim(
  row: { id?: number; status?: string | null; localPath?: string | null; templateData?: string | null; updatedAt?: Date | null } | null | undefined,
  lease: GenerationClaimLease,
) {
  return !!row
    && Number(row.id || lease.id) === lease.id
    && row.status === "processing"
    && !row.localPath
    && row.updatedAt instanceof Date
    && row.updatedAt.getTime() === lease.revision.getTime()
    && String(row.templateData || "").includes(generationClaimTokenNeedle(lease.token));
}

function nextRevision(current: Date) {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

export async function runGenerationClaimWrite<T>(
  lease: GenerationClaimLease,
  writer: (revision: Date, next: Date) => Promise<T>,
): Promise<T> {
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  lease.tail = lease.tail.then(async () => {
    if (lease.lostError) throw lease.lostError;
    const revision = lease.revision;
    const next = nextRevision(revision);
    try {
      const value = await writer(revision, next);
      lease.revision = next;
      resolveResult(value);
    } catch (error) {
      if (error instanceof GenerationClaimLostError) lease.lostError = error;
      rejectResult(error);
    }
  }).catch((error) => {
    lease.lostError ||= error instanceof Error ? error : new Error(String(error));
    rejectResult(error);
  });
  return result;
}

export async function heartbeatGenerationClaim(lease: GenerationClaimLease) {
  try {
    return await runGenerationClaimWrite(lease, async (revision, next) => {
      const result = await prisma.generation.updateMany({
        where: generationClaimOwnerWhere(lease, revision) as any,
        data: { updatedAt: next } as any,
      });
      if (!result.count) throw new GenerationClaimLostError();
      return true;
    });
  } catch (error) {
    lease.lostError ||= error instanceof Error ? error : new Error(String(error));
    throw error;
  }
}

export async function withGenerationClaimHeartbeat<T>(
  lease: GenerationClaimLease,
  operation: () => Promise<T>,
): Promise<T> {
  await heartbeatGenerationClaim(lease);
  const timer = setInterval(() => {
    void heartbeatGenerationClaim(lease).catch(() => undefined);
  }, GENERATION_CLAIM_HEARTBEAT_MS);
  timer.unref?.();
  try {
    const value = await operation();
    clearInterval(timer);
    await lease.tail;
    if (lease.lostError) throw lease.lostError;
    return value;
  } finally {
    clearInterval(timer);
  }
}

export async function releaseGenerationClaim(lease: GenerationClaimLease, data: Record<string, any>) {
  return runGenerationClaimWrite(lease, async (revision, next) => {
    const released = await prisma.generation.updateMany({
      where: generationClaimOwnerWhere(lease, revision) as any,
      data: { ...data, updatedAt: next } as any,
    });
    if (!released.count) throw new GenerationClaimLostError();
    return true;
  });
}

function scheduleGenerationProjectionSync(
  generationId: number,
  snapshot: Record<string, any>,
  stage: "terminal" | "child",
) {
  void Promise.allSettled([
    upsertUsageLedgerForGeneration(snapshot as any),
    upsertAdminAssetFeedForRows([snapshot as any]),
  ]).then((results) => {
    const labels = ["usage ledger", "admin asset feed"];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn(
          `[generation] ${stage} ${labels[index]} sync failed`,
          { generationId, error: result.reason },
        );
      }
    });
  });
}

export async function terminalizeGenerationClaim(
  lease: GenerationClaimLease,
  terminalData: Record<string, any>,
  terminalSnapshot: Record<string, any>,
) {
  return runGenerationClaimWrite(lease, async (revision, next) => {
    const committed = await prisma.$transaction(async (tx) => {
      const terminal = await tx.generation.updateMany({
        where: generationClaimOwnerWhere(lease, revision) as any,
        data: { ...terminalData, updatedAt: next } as any,
      });
      if (!terminal.count) throw new GenerationClaimLostError();
      return true;
    });
    const committedSnapshot = { ...terminalSnapshot, ...terminalData, updatedAt: next };
    scheduleGenerationProjectionSync(lease.id, committedSnapshot, "terminal");
    return committed;
  });
}

export async function bindGenerationChildToClaim(
  lease: GenerationClaimLease,
  input: {
    childWhere: Record<string, any>;
    childData: Record<string, any>;
    buildParentTemplateData: (latestTemplateData: string | null, child: Record<string, any>) => string;
  },
) {
  return runGenerationClaimWrite(lease, async (revision, next) => {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the parent owner first. Every child path uses this same lock order.
      const touched = await tx.generation.updateMany({
        where: generationClaimOwnerWhere(lease, revision) as any,
        data: { updatedAt: next } as any,
      });
      if (!touched.count) throw new GenerationClaimLostError();

      const parent = await tx.generation.findUnique({
        where: { id: lease.id },
        select: { templateData: true, canvasId: true },
      });
      if (!parent) throw new GenerationClaimLostError();

      let child = await tx.generation.findFirst({
        where: input.childWhere as any,
        include: { authUser: { select: { username: true } } },
      });
      let created = false;
      if (!child) {
        child = await runGenerationCompletionCreate(() => tx.generation.create({
          data: { ...input.childData, canvasId: parent.canvasId } as any,
          include: { authUser: { select: { username: true } } },
        }));
        created = true;
      }

      const parentTemplateData = input.buildParentTemplateData(parent.templateData, child as any);
      const metadata = await tx.generation.updateMany({
        where: {
          ...generationClaimOwnerWhere(lease, next),
          templateData: parent.templateData,
        } as any,
        data: { templateData: parentTemplateData, updatedAt: next } as any,
      });
      if (!metadata.count) throw new GenerationClaimLostError();

      return { child, created, parentTemplateData };
    });
    scheduleGenerationProjectionSync(Number(result.child.id), result.child as any, "child");
    return result;
  });
}
