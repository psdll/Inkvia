export const TOOL_MEDIA_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const TOOL_MEDIA_RELEASE_RETENTION_MS = 10 * 60 * 1000;
export const TOOL_MEDIA_RELAY_GRACE_MS = 30 * 60 * 1000;

const TOOL_MEDIA_LOCAL_PREFIXES = [
  "/uploads/imports/",
  "/uploads/tool_inputs/",
  "/uploads/batch_imports/",
] as const;

type ToolMediaRetentionReason = "draft" | "release";

export function toolMediaRetentionDeadline(reason: ToolMediaRetentionReason, now: Date): Date {
  const retentionMs = reason === "draft" ? TOOL_MEDIA_DRAFT_RETENTION_MS : TOOL_MEDIA_RELEASE_RETENTION_MS;
  return new Date(now.getTime() + retentionMs);
}

export function isToolInputMedia(metadata: unknown): boolean {
  return typeof metadata === "object" && metadata !== null && "origin" in metadata && metadata.origin === "tool_input";
}

export function isToolMediaLocalPath(value: unknown): boolean {
  const normalized = String(value || "").trim().replaceAll("\\", "/");
  return TOOL_MEDIA_LOCAL_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

export function canSoftDeleteToolMedia({
  metadata,
  status,
  generationInputCount,
}: {
  metadata: unknown;
  status: string;
  generationInputCount: number;
}): boolean {
  return isToolInputMedia(metadata) && status === "ready" && generationInputCount === 0;
}

export function isTerminalGenerationStatus(status: string): boolean {
  return status === "success" || status === "failed";
}

export function canPurgeToolRelay({
  metadata,
  generationStatuses,
  latestFinishedAt,
  now,
}: {
  metadata: unknown;
  generationStatuses: string[];
  latestFinishedAt: Date | null;
  now: Date;
}): boolean {
  return (
    isToolInputMedia(metadata) &&
    generationStatuses.length > 0 &&
    generationStatuses.every(isTerminalGenerationStatus) &&
    latestFinishedAt !== null &&
    now.getTime() >= latestFinishedAt.getTime() + TOOL_MEDIA_RELAY_GRACE_MS
  );
}
