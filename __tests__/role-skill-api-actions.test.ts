import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  authUserId: 7,
  create: vi.fn(async ({ authUserId }: any) => ({ id: "personal:9", authUserId })),
  update: vi.fn(async () => ({ id: "personal:9", revision: 2 })),
  get: vi.fn(async () => ({ id: "personal:9", content: "完整内容" })),
  getSystem: vi.fn(async () => ({ id: "system:3", content: "系统完整内容" })),
  createSystem: vi.fn(async () => ({
    id: "system:3",
    name: "商品精修",
    revision: 1,
    status: "published",
  })),
  saveFeatureBindings: vi.fn(async () => undefined),
  audit: vi.fn(async (_input: any) => undefined),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: vi.fn(async () => fake.authUserId) }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: vi.fn(() => ({ ok: true, username: "admin" })),
}));
vi.mock("@/lib/admin-audit", () => ({ logAdminAction: fake.audit }));
vi.mock("@/lib/role-skills/feature-bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/role-skills/feature-bindings")>()),
  saveRoleSkillFeatureBindings: fake.saveFeatureBindings,
}));
vi.mock("@/lib/role-skills/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/role-skills/repository")>();
  return {
    ...actual,
    createPersonalRoleSkill: fake.create,
    updatePersonalRoleSkill: fake.update,
    getPersonalRoleSkill: fake.get,
    getSystemRoleSkillForUser: fake.getSystem,
    createSystemRoleSkill: fake.createSystem,
  };
});

const value = {
  name: "商品精修",
  summary: "简介",
  category: "商业广告",
  coverUrl: "/uploads/role_skill_covers/users/7/cover.webp",
  content: "完整内容",
  usageScenario: "商品图",
  usageGuide: "上传图片",
};

describe("role skill API actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([null, undefined, "", "   "])("accepts missing covers for personal and system saves: %s", async (coverUrl) => {
    const { normalizePersonalRoleSkillValue, normalizeSystemRoleSkillValue } = await import("@/lib/role-skills/http");
    expect(normalizePersonalRoleSkillValue({ ...value, coverUrl }).coverUrl).toBeNull();
    expect(normalizeSystemRoleSkillValue({ ...value, coverUrl }).coverUrl).toBeNull();
  });

  it("creates a personal skill using only the session owner", async () => {
    const { POST } = await import("@/app/api/role-skills/personal/route");
    const response = await POST(new Request("http://localhost/api/role-skills/personal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    }));
    expect(response.status).toBe(201);
    expect(fake.create).toHaveBeenCalledWith({ authUserId: 7, value });
  });

  it("loads personal content on demand for its owner", async () => {
    const { GET } = await import("@/app/api/role-skills/personal/[skillId]/route");
    const response = await GET(
      new Request("http://localhost/api/role-skills/personal/personal:9"),
      { params: { skillId: "personal:9" } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      skill: { id: "personal:9", content: "完整内容" },
    });
  });

  it("loads published system content on demand for a signed-in user", async () => {
    const { GET } = await import("@/app/api/role-skills/system/[skillId]/route");
    const response = await GET(
      new Request("http://localhost/api/role-skills/system/system:3"),
      { params: { skillId: "system:3" } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      skill: { id: "system:3", content: "系统完整内容" },
    });
    expect(fake.getSystem).toHaveBeenCalledWith("system:3");
  });

  it("maps revision conflicts to a stable public code", async () => {
    const { RoleSkillRepositoryError } = await import("@/lib/role-skills/repository");
    fake.update.mockRejectedValueOnce(
      new RoleSkillRepositoryError("conflict", "技能已被其他操作修改"),
    );
    const { PATCH } = await import("@/app/api/role-skills/personal/[skillId]/route");
    const response = await PATCH(
      new Request("http://localhost/api/role-skills/personal/personal:9", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...value, expectedRevision: 1 }),
      }),
      { params: { skillId: "personal:9" } },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SKILL_REVISION_CONFLICT" });
  });

  it("audits system writes without recording full skill content", async () => {
    const { POST } = await import("@/app/api/admin/role-skills/system/route");
    const response = await POST(new Request("http://localhost/api/admin/role-skills/system", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...value,
        mediaType: "image",
        status: "published",
        featureKeys: ["batch_workbench.live_video"],
      }),
    }));
    expect(response.status).toBe(201);
    expect(fake.audit).toHaveBeenCalledOnce();
    expect(fake.createSystem).toHaveBeenCalledWith({
      value: { ...value, mediaType: "image" },
      status: "published",
    });
    expect(fake.saveFeatureBindings).toHaveBeenCalledWith(
      "system:3",
      ["batch_workbench.live_video"],
    );
    const auditInput = fake.audit.mock.calls[0][0];
    expect(JSON.stringify(auditInput)).not.toContain(value.content);
    expect(auditInput.metadata).toEqual({
      skillId: "system:3",
      revision: 1,
      status: "published",
    });
  });
});
