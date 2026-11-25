import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveDraftTarget: vi.fn(),
  testProviderLine: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/providers/upstream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/upstream")>();
  return {
    ...actual,
    resolveDraftTarget: mocks.resolveDraftTarget,
    testProviderLine: mocks.testProviderLine,
  };
});

import { POST } from "@/app/api/admin/providers/test/route";
import { ProviderNetworkError } from "@/lib/providers/transport";

describe("admin provider line test", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the safe missing-proxy diagnosis instead of a generic draft error", async () => {
    mocks.resolveDraftTarget.mockRejectedValue(
      new ProviderNetworkError("missing-proxy", "该平台需要代理，但管理员尚未配置可用代理"),
    );

    const response = await POST(new Request("http://localhost/api/admin/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "easyrouter", egressMode: "proxy" }),
    }) as any);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      ok: false,
      message: "缺少代理配置",
    });
  });
});
