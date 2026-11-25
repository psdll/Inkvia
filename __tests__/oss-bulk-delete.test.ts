import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    delete: vi.fn(async () => ({})),
    deleteMulti: vi.fn(async (keys: string[]) => ({ deleted: keys })),
  },
  createClient: vi.fn(),
  settingValue: null as string | null,
  findSetting: vi.fn(async () =>
    mocks.settingValue
      ? { value: mocks.settingValue, updatedAt: new Date() }
      : null),
}));

vi.mock("ali-oss", () => ({
  default: function MockOss(options: unknown) {
    mocks.createClient(options);
    return mocks.client;
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: { appSetting: { findUnique: mocks.findSetting } },
}));

import { deleteOssObjects } from "@/lib/oss";

const envKeys = [
  "OSS_ENDPOINT",
  "OSS_BUCKET",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "OSS_REGION",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe("OSS bulk deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingValue = null;
    process.env.OSS_ENDPOINT = "oss-cn-test.aliyuncs.com";
    process.env.OSS_BUCKET = "test-bucket";
    process.env.OSS_ACCESS_KEY_ID = "test-id";
    process.env.OSS_ACCESS_KEY_SECRET = "test-secret";
    process.env.OSS_REGION = "oss-cn-test";
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses OSS deleteMulti in chunks of at most 1000 keys", async () => {
    const keys = Array.from({ length: 1001 }, (_, index) => `uploads/generated/${index}.png`);

    const result = await deleteOssObjects(keys);

    expect(result).toEqual({ count: 1001 });
    expect(mocks.client.delete).not.toHaveBeenCalled();
    expect(mocks.client.deleteMulti).toHaveBeenCalledTimes(2);
    expect(mocks.client.deleteMulti.mock.calls[0][0]).toHaveLength(1000);
    expect(mocks.client.deleteMulti.mock.calls[1][0]).toHaveLength(1);
  });

  it("uses the latest database account on every OSS operation", async () => {
    mocks.settingValue = JSON.stringify({
      endpoint: "oss-cn-a.aliyuncs.com",
      region: "oss-cn-a",
      bucket: "bucket-a",
      accessKeyId: "id-a",
      accessKeySecret: "secret-a",
      publicBaseUrl: "",
    });
    await deleteOssObjects(["uploads/a.png"]);

    mocks.settingValue = JSON.stringify({
      endpoint: "oss-cn-b.aliyuncs.com",
      region: "oss-cn-b",
      bucket: "bucket-b",
      accessKeyId: "id-b",
      accessKeySecret: "secret-b",
      publicBaseUrl: "",
    });
    await deleteOssObjects(["uploads/b.png"]);

    expect(
      mocks.createClient.mock.calls.map(
        ([options]) => (options as { bucket?: string }).bucket,
      ),
    ).toEqual(["bucket-a", "bucket-b"]);
  });
});
