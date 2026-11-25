import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OSS_CONFIG_SETTING_KEY,
  buildOssConfigCandidate,
  getOssConfigSafeSnapshot,
  resolveEffectiveOssConfig,
  saveOssConfig,
  validateOssConnection,
} from "@/lib/oss-config";

function createStore(initial: string | null = null) {
  let value = initial;
  let updatedAt = new Date("2026-08-11T08:00:00.000Z");
  return {
    appSetting: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.key === OSS_CONFIG_SETTING_KEY && value !== null
          ? { key: OSS_CONFIG_SETTING_KEY, value, updatedAt }
          : null),
      upsert: vi.fn(async ({ create, update }: any) => {
        value = value === null ? create.value : update.value;
        updatedAt = new Date("2026-08-11T09:00:00.000Z");
        return { key: OSS_CONFIG_SETTING_KEY, value, updatedAt };
      }),
    },
    read: () => value,
  };
}

const databaseConfig = {
  endpoint: "oss-cn-shanghai.aliyuncs.com",
  region: "oss-cn-shanghai",
  bucket: "database-bucket",
  accessKeyId: "database-id",
  accessKeySecret: "database-secret",
  publicBaseUrl: "https://cdn.example.com/relay",
};

const envKeys = [
  "OSS_ENDPOINT",
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "OSS_PUBLIC_BASE_URL",
  "RUNNINGHUB_PUBLIC_BASE_URL",
] as const;
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);

describe("OSS dynamic configuration", () => {
  beforeEach(() => {
    process.env.OSS_ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com/";
    process.env.OSS_REGION = "oss-cn-hangzhou";
    process.env.OSS_BUCKET = "env-bucket";
    process.env.OSS_ACCESS_KEY_ID = "env-id";
    process.env.OSS_ACCESS_KEY_SECRET = "env-secret";
    process.env.OSS_PUBLIC_BASE_URL = "https://env.example.com/relay/";
    delete process.env.RUNNINGHUB_PUBLIC_BASE_URL;
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses env only before a database config exists", async () => {
    const result = await resolveEffectiveOssConfig(createStore() as any);

    expect(result.source).toBe("environment");
    expect(result.config).toMatchObject({
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      bucket: "env-bucket",
      publicBaseUrl: "https://env.example.com/relay",
    });
  });

  it("uses the complete database config", async () => {
    const result = await resolveEffectiveOssConfig(
      createStore(JSON.stringify(databaseConfig)) as any,
    );

    expect(result.source).toBe("database");
    expect(result.config).toEqual(databaseConfig);
  });

  it("rejects an incomplete stored config", async () => {
    const stored = JSON.stringify({ ...databaseConfig, bucket: "" });

    await expect(
      resolveEffectiveOssConfig(createStore(stored) as any),
    ).rejects.toThrow("Bucket");
  });

  it("keeps the effective secret when input is empty", async () => {
    const candidate = await buildOssConfigCandidate(
      {
        ...databaseConfig,
        bucket: "next-bucket",
        accessKeySecret: "",
      },
      createStore(JSON.stringify(databaseConfig)) as any,
    );

    expect(candidate.accessKeySecret).toBe("database-secret");
    expect(candidate.bucket).toBe("next-bucket");
  });

  it("never returns the secret in the safe snapshot", async () => {
    const snapshot = await getOssConfigSafeSnapshot(
      createStore(JSON.stringify(databaseConfig)) as any,
    );

    expect(snapshot.config.accessKeySecretConfigured).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("database-secret");
  });

  it("uses getBucketInfo for read-only validation", async () => {
    const getBucketInfo = vi.fn(async () => ({}));

    await validateOssConnection(
      databaseConfig,
      () => ({ getBucketInfo }) as any,
    );

    expect(getBucketInfo).toHaveBeenCalledWith("database-bucket");
  });

  it("stores one complete JSON value", async () => {
    const store = createStore();

    await saveOssConfig(databaseConfig, store as any);

    expect(JSON.parse(store.read() || "null")).toEqual(databaseConfig);
  });
});
