import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  authUserId: 7 as number | null,
  adminOk: true,
  save: vi.fn(async ({ scope, authUserId }: any) => (
    scope === "system"
      ? "/uploads/role_skill_covers/system/11111111-1111-4111-8111-111111111111.webp"
      : `/uploads/role_skill_covers/users/${authUserId}/11111111-1111-4111-8111-111111111111.webp`
  )),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: vi.fn(async () => fake.authUserId) }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: vi.fn(() => fake.adminOk
    ? { ok: true, username: "admin" }
    : { ok: false, error: "未登录管理员" }),
}));
vi.mock("@/lib/role-skills/cover-storage", () => {
  class RoleSkillCoverError extends Error {
    constructor(message: string, public readonly status = 400) {
      super(message);
    }
  }
  return {
    ROLE_SKILL_COVER_MAX_BYTES: 10 * 1024 * 1024,
    RoleSkillCoverError,
    saveRoleSkillCover: fake.save,
    deleteRoleSkillCoverIfUnreferenced: vi.fn(async () => ({ deleted: true, referenced: false })),
    requirePersonalRoleSkillCoverUrl: vi.fn((value) => value),
    requireSystemRoleSkillCoverUrl: vi.fn((value) => value),
  };
});

function uploadRequest(url: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "cover.png", {
    type: "image/png",
  }));
  return new Request(url, { method: "POST", body: form });
}

describe("role skill cover routes", () => {
  beforeEach(() => {
    fake.authUserId = 7;
    fake.adminOk = true;
    vi.clearAllMocks();
  });

  it("requires login before accepting a personal cover", async () => {
    fake.authUserId = null;
    const { POST } = await import("@/app/api/role-skills/personal/cover/route");
    const response = await POST(uploadRequest("http://localhost/api/role-skills/personal/cover"));
    expect(response.status).toBe(401);
    expect(fake.save).not.toHaveBeenCalled();
  });

  it("stores personal covers under the session account", async () => {
    const { POST } = await import("@/app/api/role-skills/personal/cover/route");
    const response = await POST(uploadRequest("http://localhost/api/role-skills/personal/cover"));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      coverUrl: expect.stringContaining("/users/7/"),
    });
    expect(fake.save).toHaveBeenCalledWith(expect.objectContaining({
      scope: "personal",
      authUserId: 7,
    }));
  });

  it("requires administrator auth before accepting a system cover", async () => {
    fake.adminOk = false;
    const { POST } = await import("@/app/api/admin/role-skills/system/cover/route");
    const response = await POST(uploadRequest("http://localhost/api/admin/role-skills/system/cover"));
    expect(response.status).toBe(401);
    expect(fake.save).not.toHaveBeenCalled();
  });
});
