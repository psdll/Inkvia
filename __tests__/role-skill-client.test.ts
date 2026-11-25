import { describe, expect, it, vi } from "vitest";
import {
  createPersonalRoleSkillClient,
  deletePersonalRoleSkillClient,
  getSystemRoleSkillClient,
  invalidateRoleSkillCache,
  listRoleSkills,
  updatePersonalRoleSkillClient,
} from "@/lib/role-skills/client";

const value = {
  name: "商品精修",
  summary: "稳定生成商品图片提示词",
  category: "商业广告",
  coverUrl: null,
  content: "完整 Skill 内容",
  usageScenario: "商品图",
  usageGuide: "上传商品参考图",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("role skill client", () => {
  it("refreshes expired data", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const fetchImpl = vi.fn(async () => json({ skills: [] }));
      await listRoleSkills(fetchImpl as typeof fetch);
      now.mockReturnValue(1000 + 5 * 60 * 1000);
      await listRoleSkills(fetchImpl as typeof fetch);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it("does not repopulate invalidated cache with an older in-flight response", async () => {
    let resolve!: (response: Response) => void;
    const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }))
      .mockResolvedValueOnce(json({ skills: [{ id: "new" }] }));
    const oldRequest = listRoleSkills(fetchImpl);
    invalidateRoleSkillCache(false);
    resolve(json({ skills: [{ id: "old" }] }));
    await oldRequest;
    await expect(listRoleSkills(fetchImpl)).resolves.toEqual([{ id: "new" }]);
  });
  it("reuses catalog and detail requests across repeated openings", async () => {
    const fetchImpl = vi.fn(async (url: unknown) => json(String(url).endsWith("/api/role-skills")
      ? { skills: [{ id: "system:3" }] } : { skill: { id: "system:3", content: "正文" } }));
    await Promise.all([listRoleSkills(fetchImpl as typeof fetch), listRoleSkills(fetchImpl as typeof fetch)]);
    await listRoleSkills(fetchImpl as typeof fetch);
    await getSystemRoleSkillClient("system:3", fetchImpl as typeof fetch);
    await getSystemRoleSkillClient("system:3", fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached reads after a successful mutation", async () => {
    const fetchImpl = vi.fn(async () => json({ skills: [], skill: { id: "personal:1", ...value } }));
    await listRoleSkills(fetchImpl as typeof fetch);
    await createPersonalRoleSkillClient(value, fetchImpl as typeof fetch);
    await listRoleSkills(fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not cache failed reads", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: "失败" }, 500)).mockResolvedValueOnce(json({ skills: [] }));
    await expect(listRoleSkills(fetchImpl)).rejects.toThrow("失败");
    await expect(listRoleSkills(fetchImpl)).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("loads one account catalog without adding a surface filter", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, skills: [] }));
    await expect(listRoleSkills(fetchImpl as typeof fetch)).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/role-skills", { cache: "no-store" });
    const calls = fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(String(calls[0][0])).not.toContain("surface");
  });

  it("loads one system Skill through its read-only detail endpoint", async () => {
    const fetchImpl = vi.fn(async () => json({
      success: true,
      skill: { id: "system:3", content: "系统完整内容" },
    }));

    await expect(
      getSystemRoleSkillClient("system:3", fetchImpl as typeof fetch),
    ).resolves.toMatchObject({ id: "system:3", content: "系统完整内容" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/role-skills/system/system%3A3",
      { cache: "no-store" },
    );
  });

  it("uses the personal CRUD endpoints without sending ownership fields", async () => {
    const fetchImpl = vi.fn(async () => json({
      success: true,
      skill: { id: "personal:9", revision: 2, ...value },
    }, 201));
    await createPersonalRoleSkillClient(value, fetchImpl as typeof fetch);
    await updatePersonalRoleSkillClient("personal:9", value, 1, fetchImpl as typeof fetch);
    await deletePersonalRoleSkillClient("personal:9", 2, fetchImpl as typeof fetch);

    const calls = fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const bodies = calls
      .map((call) => call[1]?.body)
      .filter(Boolean)
      .map(String);
    expect(bodies.join("\n")).not.toMatch(/authUserId|ownerUserId|userId/);
    expect(calls.map((call) => String(call[0]))).not.toContain("/copy");
  });

  it("exposes the stable conflict code so the editor can request a reload", async () => {
    const fetchImpl = vi.fn(async () => json({
      success: false,
      code: "SKILL_REVISION_CONFLICT",
      error: "技能已被其他操作修改，请刷新后重试",
    }, 409));
    await expect(
      updatePersonalRoleSkillClient("personal:9", value, 1, fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ code: "SKILL_REVISION_CONFLICT", status: 409 });
  });
});
