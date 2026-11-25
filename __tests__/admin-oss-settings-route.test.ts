import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authOk: true,
  getSnapshot: vi.fn(),
  buildCandidate: vi.fn(),
  validate: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () =>
    mocks.authOk ? { ok: true } : { ok: false, error: "未登录" },
}));

vi.mock("@/lib/oss-config", () => ({
  OssConfigValidationError: class OssConfigValidationError extends Error {},
  getOssConfigSafeSnapshot: mocks.getSnapshot,
  buildOssConfigCandidate: mocks.buildCandidate,
  validateOssConnection: mocks.validate,
  saveOssConfig: mocks.save,
  toSafeOssConnectionError: () => "OSS 连接验证失败，请检查配置",
}));

import { GET, POST } from "@/app/api/admin/settings/aliyun-oss/route";

const candidate = {
  endpoint: "oss-cn-test.aliyuncs.com",
  region: "oss-cn-test",
  bucket: "bucket",
  accessKeyId: "id",
  accessKeySecret: "top-secret",
  publicBaseUrl: "",
};

const safe = {
  source: "database",
  ready: true,
  updatedAt: "2026-08-11T09:00:00.000Z",
  config: {
    endpoint: candidate.endpoint,
    region: candidate.region,
    bucket: candidate.bucket,
    accessKeyId: candidate.accessKeyId,
    publicBaseUrl: "",
    accessKeySecretConfigured: true,
  },
};

function postRequest() {
  return new NextRequest("http://localhost/api/admin/settings/aliyun-oss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: candidate }),
  });
}

describe("admin aliyun OSS settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authOk = true;
    mocks.getSnapshot.mockResolvedValue(safe);
    mocks.buildCandidate.mockResolvedValue(candidate);
    mocks.validate.mockResolvedValue(undefined);
    mocks.save.mockResolvedValue(safe);
  });

  it("rejects unauthenticated reads", async () => {
    mocks.authOk = false;

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/aliyun-oss"),
    );

    expect(response.status).toBe(401);
  });

  it("returns a no-store safe view without the secret", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/aliyun-oss"),
    );
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ success: true, ...safe });
    expect(JSON.stringify(body)).not.toContain("top-secret");
  });

  it("validates before saving", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.validate).toHaveBeenCalledWith(candidate);
    expect(mocks.save).toHaveBeenCalledWith(candidate);
    expect(mocks.validate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.save.mock.invocationCallOrder[0],
    );
  });

  it("does not save when read-only validation fails", async () => {
    mocks.validate.mockRejectedValue({ code: "SignatureDoesNotMatch" });

    const response = await POST(postRequest());

    expect(response.status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      success: false,
      error: "OSS 连接验证失败，请检查配置",
    });
  });
});
