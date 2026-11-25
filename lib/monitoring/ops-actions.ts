export const OPS_ACTIONS = [
  "web.start",
  "web.stop",
  "web.restart",
  "canvas-generation.start",
  "canvas-generation.stop",
  "canvas-generation.restart",
  "canvas-media.start",
  "canvas-media.stop",
  "canvas-media.restart",
  "live-video-prompt.start",
  "live-video-prompt.stop",
  "live-video-prompt.restart",
  "live-video-video.start",
  "live-video-video.stop",
  "live-video-video.restart",
  "prometheus.start",
  "prometheus.stop",
  "prometheus.restart",
  "loki.start",
  "loki.stop",
  "loki.restart",
  "alloy.start",
  "alloy.stop",
  "alloy.restart",
  "nginx.check",
  "nginx.reload",
  "logs.rotate",
] as const;

export type OpsAction = (typeof OPS_ACTIONS)[number];

const OPS_ACTION_SET = new Set<string>(OPS_ACTIONS);
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const PLAN_ID_PATTERN = /^[0-9a-f]{32}$/;

export function isOpsAction(value: unknown): value is OpsAction {
  return typeof value === "string" && OPS_ACTION_SET.has(value);
}

export function normalizeIdempotencyKey(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new Error("幂等键格式无效");
  }
  return normalized;
}

export function normalizeOperationId(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!OPERATION_ID_PATTERN.test(normalized)) throw new Error("操作编号格式无效");
  return normalized;
}

export function normalizeDeletePlanId(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!PLAN_ID_PATTERN.test(normalized)) throw new Error("删除清单编号格式无效");
  return normalized;
}

export function hasExactObjectKeys(value: unknown, expected: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}
