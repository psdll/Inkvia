import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { request as httpRequest } from "node:http";

import {
  HEALTH_STATES,
  type MonitoringServiceId,
  type ServiceStatus,
} from "@/lib/monitoring/contracts";
import {
  type OpsAction,
  normalizeDeletePlanId,
  normalizeIdempotencyKey,
  normalizeOperationId,
} from "@/lib/monitoring/ops-actions";
import {
  buildServerEventsOpsPath,
  type ServerEventQuery,
  sanitizeServerEventsPayload,
} from "@/lib/monitoring/server-events";

const DEFAULT_SOCKET_PATH = "/run/inkvia-ops/ops.sock";
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const SERVER_EVENTS_REQUEST_TIMEOUT_MS = 6_000;

export type OpsOperation = {
  id: string;
  action: OpsAction | "logs.delete";
  state: "queued" | "running" | "succeeded" | "failed";
  acceptedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
};

export type OpsLogDeletePlan = {
  planId: string;
  createdAt: string;
  expiresAt: string;
  files: Array<{
    name: string;
    sizeBytes: number;
    modifiedAt: string;
  }>;
  totalBytes: number;
};

type OpsStatusPayload = {
  observedAt: string;
  services: ServiceStatus[];
};

export const OPS_STATUS_SERVICE_IDS = [
  "web",
  "generation-worker",
  "media-worker",
  "live-video-prompt-worker",
  "live-video-video-worker",
  "nginx",
  "postgresql",
  "prometheus",
  "loki",
  "tempo",
  "grafana",
  "alloy",
  "alertmanager",
  "postgres-exporter",
  "ops",
] as const satisfies readonly MonitoringServiceId[];
const SERVICE_IDS = new Set<MonitoringServiceId>(OPS_STATUS_SERVICE_IDS);
const HEALTH_STATE_SET = new Set<string>(HEALTH_STATES);

type SignatureInput = {
  method: string;
  path: string;
  body: string;
  timestamp: string;
  nonce: string;
  secret: string;
};

function canonicalRequest(input: SignatureInput, bodySha256: string) {
  return [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    bodySha256,
  ].join("\n");
}

export function createOpsRequestSignature(input: SignatureInput) {
  const bodySha256 = createHash("sha256").update(input.body, "utf8").digest("hex");
  const signature = createHmac("sha256", input.secret)
    .update(canonicalRequest(input, bodySha256), "utf8")
    .digest("hex");
  return { bodySha256, signature };
}

function opsSecret() {
  const secret = String(process.env.MONITORING_OPS_HMAC_SECRET || "");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("独立运维服务签名密钥未配置");
  }
  return secret;
}

function opsSocketPath() {
  const configured = String(process.env.MONITORING_OPS_SOCKET || DEFAULT_SOCKET_PATH).trim();
  if (!configured.startsWith("/") || !configured.endsWith(".sock") || configured.includes("..") || configured.length > 200) {
    throw new Error("独立运维服务 Socket 配置无效");
  }
  return configured;
}

function safeActor(value: string) {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 128 || /[\r\n\u0000-\u001f]/.test(actor)) {
    throw new Error("管理员标识无效");
  }
  return actor;
}

function safeResponseSignature(body: string, signature: string | undefined, secret: string) {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function requestOps<T>(
  method: "GET" | "POST",
  path: string,
  payload?: Record<string, unknown>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const secret = opsSecret();
  const body = payload ? JSON.stringify(payload) : "";
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("独立运维服务请求过大");
  }
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = randomBytes(16).toString("hex");
  const { bodySha256, signature } = createOpsRequestSignature({
    method,
    path,
    body,
    timestamp,
    nonce,
    secret,
  });

  return new Promise<T>((resolve, reject) => {
    const request = httpRequest({
      socketPath: opsSocketPath(),
      path,
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body, "utf8"),
        "x-inkvia-timestamp": timestamp,
        "x-inkvia-nonce": nonce,
        "x-inkvia-body-sha256": bodySha256,
        "x-inkvia-signature": signature,
      },
      timeout: timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("独立运维服务响应过大"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (!safeResponseSignature(
          responseBody,
          response.headers["x-inkvia-response-signature"] as string | undefined,
          secret,
        )) {
          reject(new Error("独立运维服务响应签名无效"));
          return;
        }
        let parsed: any;
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {};
        } catch {
          reject(new Error("独立运维服务返回了无效数据"));
          return;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(typeof parsed?.error === "string" ? parsed.error : "独立运维操作失败"));
          return;
        }
        resolve(parsed as T);
      });
    });
    request.on("timeout", () => request.destroy(new Error("独立运维服务响应超时")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export function submitOpsOperation(input: {
  action: OpsAction;
  idempotencyKey: string;
  actor: string;
}) {
  return requestOps<OpsOperation>("POST", "/v1/operations", {
    action: input.action,
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    actor: safeActor(input.actor),
  });
}

export function readOpsOperation(operationId: string) {
  const normalized = normalizeOperationId(operationId);
  return requestOps<OpsOperation>("GET", `/v1/operations/${normalized}`);
}

export function sanitizeOpsStatusPayload(payload: unknown, now = Date.now()): OpsStatusPayload {
  const candidate = payload as any;
  if (!Number.isFinite(now) || now <= 0 || !Array.isArray(candidate?.services)) {
    throw new Error("独立运维服务状态响应无效");
  }
  if (candidate.services.length !== OPS_STATUS_SERVICE_IDS.length) {
    throw new Error("独立运维服务未返回完整状态");
  }
  const observedAt = new Date(candidate?.observedAt || "");
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error("独立运维服务状态响应无效");
  }
  if (observedAt.getTime() > now + 30_000) {
    throw new Error("独立运维服务状态时间异常");
  }
  const payloadStale = now - observedAt.getTime() > 30_000;
  const seenIds = new Set<MonitoringServiceId>();
  const services = candidate.services.slice(0, 32).flatMap((item: any) => {
    if (
      !item
      || !SERVICE_IDS.has(item.id)
      || seenIds.has(item.id)
      || !HEALTH_STATE_SET.has(item.state)
      || typeof item.name !== "string"
      || item.name.length < 1
      || item.name.length > 100
    ) {
      return [];
    }
    const updatedAt = new Date(item.updatedAt || "");
    if (Number.isNaN(updatedAt.getTime()) || updatedAt.getTime() > now + 30_000) return [];
    seenIds.add(item.id);
    const stale = payloadStale || now - updatedAt.getTime() > 30_000;
    const message = typeof item.message === "string" ? item.message.slice(0, 500) : undefined;
    return [{
      id: item.id,
      name: item.name,
      state: stale && item.state === "healthy" ? "stale" : item.state,
      controllable: stale ? false : item.controllable === true,
      updatedAt: updatedAt.toISOString(),
      message: stale
        ? `${message ? `${message}；` : ""}状态更新时间已超过 30 秒`
        : message,
      uptimeSeconds: Number.isFinite(item.uptimeSeconds) && Number(item.uptimeSeconds) >= 0
        ? Number(item.uptimeSeconds)
        : null,
      pid: Number.isInteger(item.pid) && Number(item.pid) > 0 ? Number(item.pid) : null,
    } satisfies ServiceStatus];
  });
  if (
    services.length !== OPS_STATUS_SERVICE_IDS.length
    || seenIds.size !== OPS_STATUS_SERVICE_IDS.length
    || OPS_STATUS_SERVICE_IDS.some((id) => !seenIds.has(id))
  ) {
    throw new Error("独立运维服务未返回完整状态");
  }
  return { observedAt: observedAt.toISOString(), services };
}

export async function readOpsStatus() {
  const payload = await requestOps<unknown>("GET", "/v1/status");
  return sanitizeOpsStatusPayload(payload);
}

export async function readOpsServerEvents(query: ServerEventQuery) {
  const path = buildServerEventsOpsPath(query);
  const payload = await requestOps<unknown>("GET", path, undefined, SERVER_EVENTS_REQUEST_TIMEOUT_MS);
  return sanitizeServerEventsPayload(payload, {
    now: Date.now(),
    from: query.from,
    to: query.to,
    limit: query.limit,
  });
}

export function createOpsLogDeletePlan(actor: string) {
  return requestOps<OpsLogDeletePlan>("POST", "/v1/logs/delete-plan", {
    actor: safeActor(actor),
  });
}

export function applyOpsLogDeletePlan(input: {
  planId: string;
  idempotencyKey: string;
  actor: string;
}) {
  return requestOps<OpsOperation>("POST", "/v1/logs/delete-apply", {
    planId: normalizeDeletePlanId(input.planId),
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    actor: safeActor(input.actor),
  });
}
