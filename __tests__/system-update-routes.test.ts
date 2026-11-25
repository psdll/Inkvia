import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  runDeploymentHealth: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: mocks.requireAdminRequest,
}));
vi.mock("@/lib/deployment-health", () => ({
  runDeploymentHealth: mocks.runDeploymentHealth,
}));

import { GET as getSummary } from "@/app/api/admin/system-update/route";

function request() {
  return new Request("https://admin.example.test/api/admin/system-update") as any;
}

describe("read-only system version administrator route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
    mocks.runDeploymentHealth.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        version: "Inkvia-v2026.08.23.2",
        commit: "244869cdb02037df3acd223d6491cd12bb3bec9f",
      },
    });
  });

  it("authenticates before returning current identity", async () => {
    mocks.requireAdminRequest.mockReturnValue({ ok: false, error: "unauthorized" });

    const response = await getSummary(request());

    expect(response.status).toBe(401);
    expect(mocks.runDeploymentHealth).not.toHaveBeenCalled();
  });

  it("returns only the current version and commit", async () => {
    const response = await getSummary(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      success: true,
      current: {
        version: "Inkvia-v2026.08.23.2",
        commit: "244869cdb02037df3acd223d6491cd12bb3bec9f",
      },
    });
  });
});
