import crypto from "node:crypto";
import prisma from "@/lib/prisma";

type MediaCleanupResult = {
  ossError?: string;
  failedOssKeys?: string[];
  failedLocalFiles?: string[];
};

function uniqueRefs(refs: unknown[]) {
  return Array.from(new Set(refs.map((ref) => String(ref || "").trim()).filter(Boolean)));
}

export function mediaCleanupNeedsRetry(result: MediaCleanupResult) {
  return Boolean(
    String(result.ossError || "").trim()
    || (result.failedOssKeys?.length || 0) > 0
    || (result.failedLocalFiles?.length || 0) > 0,
  );
}

export async function enqueueMediaCleanupRetry(
  refs: unknown[],
  context: Record<string, unknown> = {},
) {
  const normalizedRefs = uniqueRefs(refs);
  if (!normalizedRefs.length) return null;
  return prisma.adminEvent.create({
    data: {
      eventType: "media_cleanup_retry",
      entityType: "media_cleanup",
      entityId: crypto.randomUUID(),
      payload: { refs: normalizedRefs, ...context },
      occurredAt: new Date(),
    },
  });
}

export async function enqueueMediaCleanupRetryIfNeeded(
  refs: unknown[],
  result: MediaCleanupResult,
  context: Record<string, unknown> = {},
) {
  return mediaCleanupNeedsRetry(result)
    ? enqueueMediaCleanupRetry(refs, context)
    : null;
}
