import "server-only";

import OSS from "ali-oss";
import prisma from "@/lib/prisma";

export const OSS_CONFIG_SETTING_KEY = "oss.config.v1";

export type OssConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  publicBaseUrl: string;
};

export type OssConfigInput = Omit<OssConfig, "accessKeySecret"> & {
  accessKeySecret?: string;
};

export type OssConfigStore = {
  appSetting: {
    findUnique(args: { where: { key: string } }): Promise<{
      key: string;
      value: string;
      updatedAt: Date;
    } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string };
      update: { value: string };
    }): Promise<{ key: string; value: string; updatedAt: Date }>;
  };
};

export type OssConfigSafeSnapshot = {
  source: "database" | "environment";
  ready: boolean;
  updatedAt: string | null;
  config: Omit<OssConfig, "accessKeySecret"> & {
    accessKeySecretConfigured: boolean;
  };
};

type OssBucketInfoClient = {
  getBucketInfo(bucket: string): Promise<unknown>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export class OssConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OssConfigValidationError";
  }
}

export function normalizeOssEndpoint(value: unknown) {
  return text(value).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function normalizeOssPublicBaseUrl(value: unknown) {
  const raw = text(value).replace(/\/+$/, "");
  if (!raw) return "";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OssConfigValidationError("Public Base URL 格式无效");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new OssConfigValidationError(
      "Public Base URL 仅支持 http 或 https",
    );
  }
  const pathname = url.pathname === "/"
    ? ""
    : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function normalizeOssConfig(raw: Partial<OssConfig>): OssConfig {
  return {
    endpoint: normalizeOssEndpoint(raw.endpoint),
    region: text(raw.region),
    bucket: text(raw.bucket),
    accessKeyId: text(raw.accessKeyId),
    accessKeySecret: text(raw.accessKeySecret),
    publicBaseUrl: normalizeOssPublicBaseUrl(raw.publicBaseUrl),
  };
}

export function assertCompleteOssConfig(config: OssConfig) {
  const required: Array<[keyof OssConfig, string]> = [
    ["endpoint", "Endpoint"],
    ["region", "Region"],
    ["bucket", "Bucket"],
    ["accessKeyId", "AccessKey ID"],
    ["accessKeySecret", "AccessKey Secret"],
  ];
  const missing = required.find(([key]) => !config[key]);
  if (missing) {
    throw new OssConfigValidationError(`${missing[1]} 不能为空`);
  }
}

function environmentConfig() {
  return normalizeOssConfig({
    endpoint: process.env.OSS_ENDPOINT,
    region: process.env.OSS_REGION,
    bucket: process.env.OSS_BUCKET,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    // Legacy public URL alias protects shared media configured before provider retirement.
    publicBaseUrl:
      process.env.OSS_PUBLIC_BASE_URL ||
      process.env.RUNNINGHUB_PUBLIC_BASE_URL,
  });
}

function parseStoredConfig(value: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new OssConfigValidationError(
      "数据库中的 OSS 配置不是有效 JSON",
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OssConfigValidationError("数据库中的 OSS 配置格式无效");
  }
  const config = normalizeOssConfig(raw as Partial<OssConfig>);
  assertCompleteOssConfig(config);
  return config;
}

export async function resolveEffectiveOssConfig(
  store: OssConfigStore = prisma as unknown as OssConfigStore,
) {
  const row = await store.appSetting.findUnique({
    where: { key: OSS_CONFIG_SETTING_KEY },
  });
  if (row) {
    return {
      source: "database" as const,
      config: parseStoredConfig(row.value),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  return {
    source: "environment" as const,
    config: environmentConfig(),
    updatedAt: null,
  };
}

export async function buildOssConfigCandidate(
  input: OssConfigInput,
  store: OssConfigStore = prisma as unknown as OssConfigStore,
) {
  const current = await resolveEffectiveOssConfig(store);
  const config = normalizeOssConfig({
    ...input,
    accessKeySecret:
      text(input.accessKeySecret) || current.config.accessKeySecret,
  });
  assertCompleteOssConfig(config);
  return config;
}

function safeSnapshot(
  source: "database" | "environment",
  config: OssConfig,
  updatedAt: string | null,
): OssConfigSafeSnapshot {
  const { accessKeySecret, ...visible } = config;
  return {
    source,
    ready: Boolean(
      config.endpoint &&
        config.region &&
        config.bucket &&
        config.accessKeyId &&
        accessKeySecret,
    ),
    updatedAt,
    config: {
      ...visible,
      accessKeySecretConfigured: Boolean(accessKeySecret),
    },
  };
}

export async function getOssConfigSafeSnapshot(
  store: OssConfigStore = prisma as unknown as OssConfigStore,
) {
  const result = await resolveEffectiveOssConfig(store);
  return safeSnapshot(result.source, result.config, result.updatedAt);
}

export async function saveOssConfig(
  input: OssConfig,
  store: OssConfigStore = prisma as unknown as OssConfigStore,
) {
  const config = normalizeOssConfig(input);
  assertCompleteOssConfig(config);
  const value = JSON.stringify(config);
  const row = await store.appSetting.upsert({
    where: { key: OSS_CONFIG_SETTING_KEY },
    create: { key: OSS_CONFIG_SETTING_KEY, value },
    update: { value },
  });
  return safeSnapshot("database", config, row.updatedAt.toISOString());
}

export function createOssClient(config: OssConfig) {
  return new OSS({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    secure: true,
    timeout: "60000",
  });
}

export async function validateOssConnection(
  config: OssConfig,
  factory: (config: OssConfig) => OssBucketInfoClient = createOssClient,
) {
  await factory(config).getBucketInfo(config.bucket);
}

export function toSafeOssConnectionError(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? "");
  if (code === "InvalidAccessKeyId") return "AccessKey ID 无效";
  if (code === "SignatureDoesNotMatch") {
    return "AccessKey Secret 或 Region 不正确";
  }
  if (code === "NoSuchBucket") return "Bucket 不存在";
  if (code === "AccessDenied") {
    return "当前账号没有读取 Bucket 信息的权限";
  }
  if (code === "RequestError" || code === "ConnectionTimeoutError") {
    return "无法连接 OSS Endpoint";
  }
  return "OSS 连接验证失败，请检查配置";
}
