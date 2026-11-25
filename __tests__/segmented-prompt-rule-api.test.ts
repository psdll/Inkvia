import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settings = new Map<string, { value: string; updatedAt: Date }>();
  return {
    settings,
    requireAdminRequest: vi.fn(),
    findUnique: vi.fn(async ({ where }: any) => {
      const row = settings.get(where.key);
      return row ? { key: where.key, ...row } : null;
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const value = settings.has(where.key) ? update.value : create.value;
      const row = { value, updatedAt: new Date("2026-08-06T09:00:00.000Z") };
      settings.set(where.key, row);
      return { key: where.key, ...row };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const count = settings.delete(where.key) ? 1 : 0;
      return { count };
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
      deleteMany: mocks.deleteMany,
    },
  },
}));

import {
  DELETE,
  GET,
  POST,
} from "@/app/api/admin/settings/segmented-prompt-rule/route";

function request(method: "GET" | "POST" | "DELETE", body?: unknown) {
  return new Request(
    "http://localhost/api/admin/settings/segmented-prompt-rule",
    {
      method,
      headers: body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  ) as any;
}

describe("administrator segmented prompt rule API", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.requireAdminRequest.mockReset();
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
  });

  it("protects every operation with administrator authentication", async () => {
    mocks.requireAdminRequest.mockReturnValue({ ok: false, error: "未登录" });

    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", {}))).status).toBe(401);
    expect((await DELETE(request("DELETE", {}))).status).toBe(401);
  });

  it("loads, saves, rejects stale writes, and restores the global rule", async () => {
    const initial = await GET(request("GET"));
    expect(await initial.json()).toMatchObject({
      success: true,
      config: { revision: 1, source: "default" },
    });

    const saved = await POST(request("POST", {
      ruleText: "没有标题时，每个非空行作为一个分段。",
      expectedRevision: 1,
    }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      success: true,
      config: { revision: 2, source: "custom" },
    });

    const stale = await POST(request("POST", {
      ruleText: "过期修改",
      expectedRevision: 1,
    }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      success: false,
      code: "RULE_REVISION_CONFLICT",
    });

    const reset = await DELETE(request("DELETE", { expectedRevision: 2 }));
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({
      success: true,
      config: { revision: 1, source: "default" },
    });
  });

  it("rejects an empty rule", async () => {
    const response = await POST(request("POST", {
      ruleText: "  ",
      expectedRevision: 1,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "RULE_EMPTY",
    });
  });
});
