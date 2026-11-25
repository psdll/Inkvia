import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const timestamp = "2026-08-05T08:00:00.000Z";

function archivedSkill(id = "7") {
  return {
    id,
    name: "商品摄影",
    summary: "稳定生成商品素材",
    category: "商业广告",
    coverUrl: "/uploads/role_skill_covers/users/11/cover.webp",
    content: "完整系统提示词",
    usageScenario: "商品图",
    usageGuide: "上传商品图",
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

describe("personal role Skill account lifecycle", () => {
  it("exports all personal history using V1 without querying system Skills", async () => {
    const { buildUserRoleSkillArchiveV1 } = await import("@/lib/admin/user-export-builder");
    const client = {
      userRoleSkill: {
        findMany: vi.fn(async () => [{
          ...archivedSkill("9"),
          id: BigInt(9),
          createdAt: new Date(timestamp),
          updatedAt: new Date(timestamp),
          deletedAt: new Date("2026-08-05T09:00:00.000Z"),
        }]),
      },
      systemRoleSkill: { findMany: vi.fn() },
    };

    const archive = await buildUserRoleSkillArchiveV1(client, 11);

    expect(client.userRoleSkill.findMany).toHaveBeenCalledWith({
      where: { authUserId: 11 },
      orderBy: { id: "asc" },
    });
    expect(client.systemRoleSkill.findMany).not.toHaveBeenCalled();
    expect(archive).toEqual({
      version: 1,
      skills: [expect.objectContaining({
        id: "9",
        content: "完整系统提示词",
        coverUrl: "/uploads/role_skill_covers/users/11/cover.webp",
        deletedAt: "2026-08-05T09:00:00.000Z",
      })],
    });
  });

  it("validates manifest counts and rewrites the target account cover path", async () => {
    const runner = await import("@/lib/admin/user-import-runner");
    const archive = { version: 1, skills: [archivedSkill()] };

    await expect(runner.parseUserRoleSkillArchiveForImport(
      { roleSkillsVersion: 1, stats: { userRoleSkills: 1 } },
      JSON.stringify(archive),
    )).resolves.toEqual(archive);
    await expect(runner.parseUserRoleSkillArchiveForImport(
      { roleSkillsVersion: 1, stats: { userRoleSkills: 2 } },
      JSON.stringify(archive),
    )).rejects.toThrow(/数据不完整/);
    expect(runner.rewriteRoleSkillCoverUrlForImport(
      archivedSkill().coverUrl,
      11,
      25,
    )).toBe("/uploads/role_skill_covers/users/25/cover.webp");
  });

  it("accepts omitted skills only when workspace export was disabled and the count is zero", async () => {
    const { parseUserRoleSkillArchiveForImport: parse } = await import("@/lib/admin/user-import-runner");
    await expect(parse({ roleSkillsVersion: 1, options: { workspaceData: false }, stats: { userRoleSkills: 0 } }, undefined)).resolves.toBeNull();
    for (const manifest of [
      { roleSkillsVersion: 1, options: { workspaceData: true }, stats: { userRoleSkills: 0 } },
      { roleSkillsVersion: 1, stats: { userRoleSkills: 0 } },
      { roleSkillsVersion: 1, options: { workspaceData: false }, stats: { userRoleSkills: 1 } },
      { roleSkillsVersion: 1, options: { workspaceData: false } },
    ]) {
      await expect(parse(manifest, undefined)).rejects.toThrow("缺少 data/user_role_skills.json");
    }
  });

  it("imports V1 skill content without writing the derived workspace to the database", async () => {
    const { restoreUserRoleSkillArchiveV1 } = await import("@/lib/admin/user-import-runner");
    const create = vi.fn(async ({ data }: any) => {
      if ("workspace" in data) throw new Error("Unknown argument `workspace`");
      return data;
    });
    const tx = {
      $executeRawUnsafe: vi.fn(),
      userRoleSkill: { findMany: vi.fn(async () => []), create },
    };

    const result = await restoreUserRoleSkillArchiveV1({
      tx,
      targetAuthUserId: 25,
      sourceArchiveUserId: 11,
      archive: { version: 1, skills: [archivedSkill()] },
    });

    expect(result).toMatchObject({ restored: 1, inserted: 1, remapped: 0 });
    expect(create).toHaveBeenCalledWith({ data: {
      ...archivedSkill(),
      id: BigInt(7),
      authUserId: 25,
      coverUrl: "/uploads/role_skill_covers/users/25/cover.webp",
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    } });
  });

  it("remaps BigInt collisions and reuses an exact prior import", async () => {
    const { restoreUserRoleSkillArchiveV1 } = await import("@/lib/admin/user-import-runner");
    const archive = { version: 1, skills: [archivedSkill()] };
    const create = vi.fn(async ({ data }: any) => {
      if ("workspace" in data) throw new Error("Unknown argument `workspace`");
      return { ...data, id: data.id ?? BigInt(901) };
    });
    const tx = {
      $executeRawUnsafe: vi.fn(async () => undefined),
      userRoleSkill: {
        findMany: vi.fn(async ({ where }: any) => where.id
          ? [{ id: BigInt(7), authUserId: 99, name: "冲突记录" }]
          : []),
        create,
      },
    };

    const first = await restoreUserRoleSkillArchiveV1({
      tx,
      targetAuthUserId: 25,
      sourceArchiveUserId: 11,
      archive,
    });

    expect(first.idMap.get(BigInt(7))).toBe(BigInt(901));
    expect(first).toMatchObject({ restored: 1, inserted: 1, reused: 0, remapped: 1 });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authUserId: 25,
        coverUrl: "/uploads/role_skill_covers/users/25/cover.webp",
      }),
    });

    const restored = create.mock.calls[0][0].data;
    tx.userRoleSkill.findMany.mockImplementation(async ({ where }: any) => where.id
      ? [{ id: BigInt(7), authUserId: 99, name: "冲突记录" }]
      : [{ ...restored, id: BigInt(901) }]);
    const repeated = await restoreUserRoleSkillArchiveV1({
      tx,
      targetAuthUserId: 25,
      sourceArchiveUserId: 11,
      archive,
    });

    expect(repeated.idMap.get(BigInt(7))).toBe(BigInt(901));
    expect(repeated).toMatchObject({ inserted: 0, reused: 1, remapped: 0 });
  });

  it("preserves history when an archived personal skill was deleted", async () => {
    const { remapPromptReverseTaskRoleSkill } = await import("@/lib/admin/user-import-runner");
    const row = {
      id: 42, skillSource: "personal", skillId: "1", skillName: "旧技能",
      skillRevision: 3, systemPrompt: "原始提示词", generatedPrompt: "历史生成结果",
    };
    const warnings: string[] = [];
    expect(remapPromptReverseTaskRoleSkill(row, new Map(), warnings)).toEqual({
      ...row, skillId: null,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("42");
    expect(row.skillId).toBe("1");
    expect(remapPromptReverseTaskRoleSkill(row, new Map([[BigInt(1), BigInt(9)]]), warnings))
      .toEqual({ ...row, skillId: BigInt(9) });
    const systemRow = { ...row, skillSource: "system" };
    expect(remapPromptReverseTaskRoleSkill(systemRow, new Map(), warnings)).toEqual(systemRow);
    expect(warnings).toHaveLength(1);
  });

  it("collects personal covers before deleting account-scoped rows", async () => {
    const { resetAdminUserRoleSkillData } = await import("@/lib/admin-user-delete");
    const calls: string[] = [];
    const client = {
      userRoleSkill: {
        findMany: vi.fn(async () => {
          calls.push("collect");
          return [
            { coverUrl: "/uploads/role_skill_covers/users/7/a.webp" },
            { coverUrl: "/uploads/role_skill_covers/users/7/a.webp" },
            { coverUrl: "/uploads/role_skill_covers/system/protected.webp" },
          ];
        }),
        deleteMany: vi.fn(async () => {
          calls.push("delete");
          return { count: 2 };
        }),
      },
      systemRoleSkill: { deleteMany: vi.fn() },
    };

    await expect(resetAdminUserRoleSkillData(client, { authUserId: 7 })).resolves.toEqual({
      deletedUserRoleSkills: 2,
      roleSkillCoverRefs: ["/uploads/role_skill_covers/users/7/a.webp"],
    });
    expect(calls).toEqual(["collect", "delete"]);
    expect(client.systemRoleSkill.deleteMany).not.toHaveBeenCalled();
  });

  it("wires export, import, purge, delete and storage reporting without system-skill deletion", () => {
    const exporter = source("lib/admin/user-export-builder.ts");
    const importer = source("lib/admin/user-import-runner.ts");
    const purge = source("app/api/admin/user/purge-data/route.ts");
    const deletion = source("app/api/admin/user/delete/route.ts");
    const storage = source("lib/admin-storage-scan.ts");
    const userRoute = source("app/api/admin/user/route.ts");

    expect(exporter).toContain("data/user_role_skills.json");
    expect(exporter).toContain("userRoleSkills: userRoleSkills.skills.length");
    expect(exporter).not.toContain("prisma.systemRoleSkill.findMany");
    expect(importer).toContain('"data/user_role_skills.json"');
    expect(importer).toContain("remapPromptReverseTaskRoleSkill");
    expect(importer).toContain("role_skill_covers/users/");
    expect(purge).toContain("resetAdminUserRoleSkillData");
    expect(purge).toContain("!canSkipAdminPassword");
    expect(deletion).toContain("deletedUserRoleSkills");
    expect(storage).toContain('label: "技能资源"');
    expect(storage).toContain("个人技能工作区");
    expect(userRoute).toContain("listRoleSkillsForAdminAudit({ authUserId: scopeInfo.authUserId })");
    expect([purge, deletion].join("\n")).not.toContain("systemRoleSkill.deleteMany");
  });
});
