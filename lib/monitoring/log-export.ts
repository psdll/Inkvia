import crypto from "node:crypto";

import type { LogFilter } from "@/lib/monitoring/loki-client";

export type LogExportDescriptor = {
  filter: LogFilter;
  fromMs: number;
  toMs: number;
};

type SignedLogExport = LogExportDescriptor & {
  exp: number;
  version: 1;
};

function signature(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

function validateSecret(secret: string) {
  if (String(secret || "").length < 16) throw new Error("日志导出签名密钥未配置");
}

function validateDescriptor(value: any): asserts value is LogExportDescriptor {
  if (!value || typeof value !== "object") throw new Error("日志导出令牌无效");
  if (!Number.isFinite(value.fromMs) || !Number.isFinite(value.toMs) || value.fromMs <= 0 || value.toMs <= value.fromMs) {
    throw new Error("日志导出时间范围无效");
  }
  if (value.toMs - value.fromMs > 24 * 60 * 60 * 1_000) {
    throw new Error("日志导出时间范围不能超过 24 小时");
  }
  if (!value.filter || typeof value.filter.service !== "string") throw new Error("日志导出筛选条件无效");
}

export function createLogExportToken(
  descriptor: LogExportDescriptor,
  secret: string,
  now = new Date(),
) {
  validateSecret(secret);
  validateDescriptor(descriptor);
  const payload: SignedLogExport = {
    ...descriptor,
    version: 1,
    exp: now.getTime() + 5 * 60 * 1_000,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function verifyLogExportToken(token: string, secret: string, now = new Date()) {
  validateSecret(secret);
  const [body, suppliedSignature, extra] = String(token || "").split(".");
  if (!body || !suppliedSignature || extra || suppliedSignature !== signature(body, secret)) {
    throw new Error("日志导出令牌无效");
  }
  let payload: SignedLogExport;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("日志导出令牌无效");
  }
  if (payload.version !== 1) throw new Error("日志导出令牌无效");
  validateDescriptor(payload);
  if (!Number.isFinite(payload.exp) || payload.exp < now.getTime()) throw new Error("日志导出令牌已过期");
  return payload;
}
