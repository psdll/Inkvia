import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  authUserId: 7 as number | null,
  adminOk: true,
  list: vi.fn(async () => [{
    id: "system:1",
    source: "system",
    name: "商品精修",
    summary: "简介",
    category: "商业广告",
    coverUrl: null,
    usageScenario: "商品图",
    usageGuide: "上传图片",
    revision: 1,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  }]),
  listAdmin: vi.fn(async () => []),
  getSystem: vi.fn(async () => ({ id: "system:1", content: "完整内容" })),
}));

vi.mock("@/lib/server-auth", () => ({
  getUserId: vi.fn(async () => fake.authUserId),
}));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: vi.fn(() => fake.adminOk
    ? { ok: true, username: "admin" }
    : { ok: false, error: "未登录管理员" }),
}));
vi.mock("@/lib/admin-audit", () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock("@/lib/role-skills/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/role-skills/repository")>();
  return {
    ...actual,
    listRoleSkillsForUser: fake.list,
    listSystemRoleSkillsForAdmin: fake.listAdmin,
    getSystemRoleSkillForUser: fake.getSystem,
  };
});

describe("role skill API authorization", () => {
  beforeEach(() => {
    fake.authUserId = 7;
    fake.adminOk = true;
    vi.clearAllMocks();
  });

  it("requires login for the ordinary catalog", async () => {
    fake.authUserId = null;
    const { GET } = await import("@/app/api/role-skills/route");
    const response = await GET(new Request("http://localhost/api/role-skills"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("returns public system metadata without content", async () => {
    const { GET } = await import("@/app/api/role-skills/route");
    const response = await GET(new Request("http://localhost/api/role-skills"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0]).not.toHaveProperty("content");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fake.list).toHaveBeenCalledWith({ authUserId: 7 });
  });

  it("requires login before returning system Skill detail content", async () => {
    fake.authUserId = null;
    const { GET } = await import("@/app/api/role-skills/system/[skillId]/route");
    const response = await GET(
      new Request("http://localhost/api/role-skills/system/system:1"),
      { params: { skillId: "system:1" } },
    );
    expect(response.status).toBe(401);
    expect(fake.getSystem).not.toHaveBeenCalled();
  });

  it("rejects client-supplied ownership fields", async () => {
    const { POST } = await import("@/app/api/role-skills/personal/route");
    const response = await POST(new Request("http://localhost/api/role-skills/personal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authUserId: 99 }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "SKILL_INVALID" });
  });

  it("requires administrator auth for system skill management", async () => {
    fake.adminOk = false;
    const { GET } = await import("@/app/api/admin/role-skills/system/route");
    const response = await GET(new Request("http://localhost/api/admin/role-skills/system"));
    expect(response.status).toBe(401);
    expect(fake.listAdmin).not.toHaveBeenCalled();
  });
});
