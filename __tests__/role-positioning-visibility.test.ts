import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settings = new Map<string, string>();
  return {
    settings,
    requireAdminRequest: vi.fn(),
    findUnique: vi.fn(async ({ where }: any) => {
      const value = settings.get(where.key);
      return value === undefined ? null : { key: where.key, value };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const value = settings.has(where.key) ? update.value : create.value;
      settings.set(where.key, value);
      return { key: where.key, value };
    }),
  };
});

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: mocks.requireAdminRequest,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    appSetting: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import {
  ROLE_POSITIONING_VISIBILITY_KEY,
  getRolePositioningVisible,
  saveRolePositioningVisible,
} from "@/lib/role-positioning-visibility";
import {
  GET as adminGet,
  POST as adminPost,
} from "@/app/api/admin/settings/role-positioning/route";
import { GET as publicGet } from "@/app/api/role-positioning/status/route";

function request(method: "GET" | "POST", body?: unknown) {
  return new Request("http://localhost/api/admin/settings/role-positioning", {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

describe("role positioning visibility", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.requireAdminRequest.mockReset();
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
    mocks.findUnique.mockClear();
    mocks.upsert.mockClear();
  });

  it("defaults to hidden and persists explicit visibility values", async () => {
    expect(await getRolePositioningVisible()).toBe(false);

    await saveRolePositioningVisible(true);
    expect(mocks.settings.get(ROLE_POSITIONING_VISIBILITY_KEY)).toBe("1");
    expect(await getRolePositioningVisible()).toBe(true);

    await saveRolePositioningVisible(false);
    expect(mocks.settings.get(ROLE_POSITIONING_VISIBILITY_KEY)).toBe("0");
    expect(await getRolePositioningVisible()).toBe(false);
  });

  it("protects administrator access and validates the boolean body", async () => {
    mocks.requireAdminRequest.mockReturnValueOnce({ ok: false, error: "未登录" });
    expect((await adminGet(request("GET"))).status).toBe(401);

    const invalid = await adminPost(request("POST", { enabled: "yes" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ success: false });

    const saved = await adminPost(request("POST", { enabled: true }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ success: true, enabled: true });

    const loaded = await adminGet(request("GET"));
    expect(await loaded.json()).toEqual({ success: true, enabled: true });
  });

  it("returns a no-store public status and fails closed", async () => {
    await saveRolePositioningVisible(true);

    const enabledResponse = await publicGet();
    expect(await enabledResponse.json()).toEqual({ enabled: true });
    expect(enabledResponse.headers.get("cache-control")).toContain("no-store");

    mocks.findUnique.mockRejectedValueOnce(new Error("db unavailable"));
    const failedResponse = await publicGet();
    expect(await failedResponse.json()).toEqual({ enabled: false });
    expect(failedResponse.headers.get("cache-control")).toContain("no-store");
  });
});
