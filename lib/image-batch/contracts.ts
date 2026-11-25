export const IMAGE_BATCH_LIMITS = {
  maxItems: 50,
  maxOutputs: 100,
  maxOutputsPerItem: 4,
  maxStyleProductImages: 20,
  maxNameLength: 120,
} as const;

export const IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE = "IMAGE_MODEL_NOT_AVAILABLE";

export type ImageBatchAggregateStatus =
  | "draft"
  | "queued"
  | "running"
  | "partial_success"
  | "success"
  | "failed"
  | "cancelled";

export type ImageBatchMode = "style_replication" | "multi_prompt";

const IMAGE_BATCH_MODE_LABELS: Record<ImageBatchMode, string> = {
  style_replication: "统一参考批量复刻",
  multi_prompt: "自定义分批",
};

export function isGroupedImageBatchMode(value: unknown): value is ImageBatchMode {
  return value === "style_replication" || value === "multi_prompt";
}

export function normalizeImageBatchMode(value: unknown): ImageBatchMode {
  return value === "multi_prompt" ? "multi_prompt" : "style_replication";
}

export function getImageBatchModeLabel(value: unknown): string | null {
  return isGroupedImageBatchMode(value) ? IMAGE_BATCH_MODE_LABELS[value] : null;
}

const ACTIVE_BATCH_STATUSES = new Set([
  "submitting",
  "running",
  "waiting_provider",
  "processing",
]);

export function splitBatchPrompts(value: unknown): string[] {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function mergeBatchSettings<T extends Record<string, unknown>>(
  shared: T,
  overrides: Partial<T> | null | undefined,
): T {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides || {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
  return { ...shared, ...definedOverrides };
}

export function combineBatchPrompt(
  sharedPrompt: unknown,
  itemPrompt: unknown,
  includeSharedPrompt: boolean,
): string {
  const shared = String(sharedPrompt || "").trim();
  const item = String(itemPrompt || "").trim();
  return includeSharedPrompt ? [shared, item].filter(Boolean).join("\n") : item;
}

export function aggregateBatchStatus(statuses: readonly string[]): ImageBatchAggregateStatus {
  const normalized = statuses.map((status) => String(status || "").trim().toLowerCase());
  if (!normalized.length) return "draft";
  if (normalized.some((status) => ACTIVE_BATCH_STATUSES.has(status))) return "running";
  if (normalized.some((status) => status === "queued")) return "queued";
  if (normalized.every((status) => status === "success")) return "success";
  if (normalized.every((status) => status === "failed")) return "failed";
  if (normalized.every((status) => status === "cancelled" || status === "canceled")) return "cancelled";
  if (normalized.some((status) => status === "success")) return "partial_success";
  if (normalized.some((status) => status === "failed")) return "failed";
  return "draft";
}

export function elapsedSeconds(
  startedAt: Date | string | null | undefined,
  finishedAt: Date | string | null | undefined,
): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}
