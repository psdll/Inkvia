import { beforeEach, describe, expect, it, vi } from "vitest";

type SkillRow = {
  id: bigint;
  authUserId?: number;
  name: string;
  summary: string;
  category: string;
  coverUrl: string | null;
  content: string;
  usageScenario: string;
  usageGuide: string;
  status?: string;
  mediaType?: string | null;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const fake = vi.hoisted(() => {
  const state = {
    systems: [] as SkillRow[],
    personals: [] as SkillRow[],
    nextId: BigInt(100),
  };
  const active = (row: SkillRow) => row.deletedAt === null;
  const matchesDeletedAt = (row: SkillRow, value: any) => {
    if (value === undefined) return true;
    if (value === null) return row.deletedAt === null;
    if (value?.not === null && row.deletedAt === null) return false;
    if (value?.gt && (!row.deletedAt || row.deletedAt <= value.gt)) return false;
    if (value?.lte && (!row.deletedAt || row.deletedAt > value.lte)) return false;
    return true;
  };
  const client = {
    systemRoleSkill: {
      findMany: vi.fn(async ({ where }: any) => state.systems.filter((row) => (
        matchesDeletedAt(row, where?.deletedAt)
        && (!where?.status || row.status === where.status)
      ))),
      findFirst: vi.fn(async ({ where }: any) => state.systems.find((row) => (
        row.id === where.id
        && matchesDeletedAt(row, where.deletedAt)
        && (where.status === undefined || row.status === where.status)
      )) || null),
      create: vi.fn(async ({ data }: any) => {
        const now = new Date("2026-08-05T08:00:00.000Z");
        const row = { id: state.nextId++, revision: 1, deletedAt: null, createdAt: now, updatedAt: now, ...data };
        state.systems.push(row);
        return row;
      }),
      updateManyAndReturn: vi.fn(async ({ where, data }: any) => {
        const row = state.systems.find((item) => (
          item.id === where.id
          && matchesDeletedAt(item, where.deletedAt)
          && item.revision === where.revision
        ));
        if (!row) return [];
        const nextRevision = row.revision + Number(data.revision?.increment || 0);
        Object.assign(row, data, { revision: nextRevision });
        return [row];
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const ids = where.id?.in || [];
        const before = state.systems.length;
        state.systems = state.systems.filter((item) => !(
          ids.includes(item.id) && matchesDeletedAt(item, where.deletedAt)
        ));
        return { count: before - state.systems.length };
      }),
    },
    userRoleSkill: {
      findMany: vi.fn(async ({ where }: any) => state.personals.filter((row) => (
        row.authUserId === where.authUserId
        && (where.deletedAt === undefined || row.deletedAt === where.deletedAt)
      ))),
      findFirst: vi.fn(async ({ where }: any) => state.personals.find((row) => (
        row.id === where.id
        && row.authUserId === where.authUserId
        && (where.deletedAt === undefined || row.deletedAt === where.deletedAt)
      )) || null),
      create: vi.fn(async ({ data }: any) => {
        const now = new Date("2026-08-05T08:00:00.000Z");
        const row = { id: state.nextId++, revision: 1, deletedAt: null, createdAt: now, updatedAt: now, ...data };
        state.personals.push(row);
        return row;
      }),
      updateManyAndReturn: vi.fn(async ({ where, data }: any) => {
        const row = state.personals.find((item) => (
          item.id === where.id
          && item.authUserId === where.authUserId
          && active(item)
          && item.revision === where.revision
        ));
        if (!row) return [];
        const nextRevision = row.revision + Number(data.revision?.increment || 0);
        Object.assign(row, data, { revision: nextRevision });
        return [row];
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = state.personals.length;
        state.personals = state.personals.filter((item) => !(
          item.id === where.id
          && item.authUserId === where.authUserId
          && item.revision === where.revision
          && matchesDeletedAt(item, where.deletedAt)
        ));
        return { count: before - state.personals.length };
      }),
    },
  };
  (client as any).$transaction = vi.fn(async (operation: (transaction: typeof client) => unknown) => {
    const systems = state.systems.map((item) => ({ ...item }));
    const personals = state.personals.map((item) => ({ ...item }));
    const nextId = state.nextId;
    try {
      return await operation(client);
    } catch (error) {
      state.systems.splice(0, state.systems.length, ...systems);
      state.personals.splice(0, state.personals.length, ...personals);
      state.nextId = nextId;
      throw error;
    }
  });
  return { client, state };
});

vi.mock("@/lib/prisma", () => ({ default: fake.client }));
const coverCleanup = vi.hoisted(() => vi.fn(async () => ({ deleted: true, referenced: false })));
vi.mock("@/lib/role-skills/cover-storage", () => ({
  deleteRoleSkillCoverIfUnreferenced: coverCleanup,
}));
const workspaceStorage = vi.hoisted(() => ({
  deleteRoleSkillWorkspace: vi.fn(async () => undefined),
  readRoleSkillWorkspace: vi.fn(async (_scope: unknown, fallbackContent: string) => ({
    files: [{ path: "SKILL.md", content: fallbackContent }],
    directories: [],
    primaryPath: "SKILL.md",
  })),
  replaceRoleSkillWorkspace: vi.fn(async () => undefined),
}));
vi.mock("@/lib/role-skills/workspace-storage", () => workspaceStorage);

import {
  RoleSkillRepositoryError,
  createSystemRoleSkill,
  deletePersonalRoleSkill,
  getSystemRoleSkillForUser,
  listRoleSkillsForUser,
  listSystemRoleSkillsForAdmin,
  purgeExpiredSystemRoleSkills,
  resolveRoleSkillForExecution,
  restoreSystemRoleSkill,
  updatePersonalRoleSkill,
  updateSystemRoleSkill,
} from "@/lib/role-skills/repository";

const at = (value: string) => new Date(value);
function row(overrides: Partial<SkillRow> & Pick<SkillRow, "id">): SkillRow {
  return {
    name: "技能",
    summary: "简介",
    category: "商业广告",
    coverUrl: null,
    content: "不可公开的系统提示词",
    usageScenario: "商品图",
    usageGuide: "上传图片",
    revision: 1,
    deletedAt: null,
    createdAt: at("2026-08-05T06:00:00.000Z"),
    updatedAt: at("2026-08-05T06:00:00.000Z"),
    ...overrides,
  };
}

describe("role skill repository", () => {
  beforeEach(() => {
    fake.state.systems.length = 0;
    fake.state.personals.length = 0;
    fake.state.nextId = BigInt(100);
    vi.clearAllMocks();
  });

  it("restores a deleted system Skill only during its 30-day retention window", async () => {
    fake.state.systems.push(
      row({ id: BigInt(1), status: "hidden", revision: 2, deletedAt: at("2026-07-08T00:00:00.001Z") }),
      row({ id: BigInt(2), status: "hidden", revision: 3, deletedAt: at("2026-07-08T00:00:00.000Z") }),
    );
    const now = at("2026-08-07T00:00:00.000Z");

    await expect(restoreSystemRoleSkill({
      publicId: "system:1",
      expectedRevision: 2,
      now,
    })).resolves.toMatchObject({ id: "system:1", deletedAt: null, status: "hidden" });
    await expect(restoreSystemRoleSkill({
      publicId: "system:2",
      expectedRevision: 3,
      now,
    })).rejects.toMatchObject({ code: "not-found" });
  });

  it("permanently deletes expired system Skills and cleans unreferenced covers", async () => {
    fake.state.systems.push(
      row({ id: BigInt(1), status: "hidden", coverUrl: "/uploads/role_skill_covers/system/old.webp", deletedAt: at("2026-07-08T00:00:00.000Z") }),
      row({ id: BigInt(2), status: "hidden", coverUrl: "/uploads/role_skill_covers/system/recent.webp", deletedAt: at("2026-07-08T00:00:00.001Z") }),
    );

    await expect(purgeExpiredSystemRoleSkills({
      now: at("2026-08-07T00:00:00.000Z"),
      limit: 20,
    })).resolves.toEqual({ deletedSkills: 1, deletedCovers: 1 });
    expect(fake.state.systems.map((item) => item.id)).toEqual([BigInt(2)]);
    expect(coverCleanup).toHaveBeenCalledWith("/uploads/role_skill_covers/system/old.webp");
  });

  it("permanently deletes a personal Skill immediately", async () => {
    fake.state.personals.push(row({
      id: BigInt(3),
      authUserId: 7,
      revision: 2,
      coverUrl: "/uploads/role_skill_covers/users/7/personal.webp",
    }));

    await expect(deletePersonalRoleSkill({
      authUserId: 7,
      publicId: "personal:3",
      expectedRevision: 2,
    })).resolves.toEqual({
      coverUrl: "/uploads/role_skill_covers/users/7/personal.webp",
    });
    expect(fake.state.personals).toEqual([]);
  });

  it("lists published system skills and only the current account personal skills without content", async () => {
    fake.state.systems.push(
      row({ id: BigInt(1), status: "published", mediaType: "video", updatedAt: at("2026-08-05T09:00:00.000Z") }),
      row({ id: BigInt(2), status: "hidden" }),
    );
    fake.state.personals.push(
      row({ id: BigInt(3), authUserId: 7, mediaType: "image", updatedAt: at("2026-08-05T08:00:00.000Z") }),
      row({ id: BigInt(4), authUserId: 8 }),
    );

    const skills = await listRoleSkillsForUser({ authUserId: 7 });

    expect(skills.map((skill) => skill.id)).toEqual(["system:1", "personal:3"]);
    expect(skills).toMatchObject([
      { id: "system:1", mediaType: "video" },
      { id: "personal:3", mediaType: "image" },
    ]);
    expect(skills.every((skill) => !("content" in skill))).toBe(true);
  });

  it("keeps the administrator system Skill list lightweight", async () => {
    fake.state.systems.push(row({
      id: BigInt(5),
      status: "published",
      mediaType: "video",
    }));

    const skills = await listSystemRoleSkillsForAdmin();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "system:5",
      status: "published",
      mediaType: "video",
      deletedAt: null,
    });
    expect(skills[0]).not.toHaveProperty("content");
    expect(skills[0]).not.toHaveProperty("workspace");
    expect(workspaceStorage.readRoleSkillWorkspace).not.toHaveBeenCalled();
  });

  it("resolves server-side content for published system and owned personal skills", async () => {
    fake.state.systems.push(row({ id: BigInt(1), status: "published", name: "系统技能" }));
    fake.state.personals.push(row({ id: BigInt(3), authUserId: 7, name: "个人技能" }));

    await expect(resolveRoleSkillForExecution({ authUserId: 7, publicId: "system:1" }))
      .resolves.toMatchObject({ source: "system", id: BigInt(1), name: "系统技能", content: "不可公开的系统提示词" });
    await expect(resolveRoleSkillForExecution({ authUserId: 7, publicId: "personal:3" }))
      .resolves.toMatchObject({ source: "personal", id: BigInt(3), name: "个人技能" });
  });

  it("returns only an available system Skill for the read-only detail", async () => {
    fake.state.systems.push(
      row({ id: BigInt(1), status: "published", name: "系统技能" }),
      row({ id: BigInt(2), status: "hidden", name: "隐藏技能" }),
    );

    await expect(getSystemRoleSkillForUser("system:1")).resolves.toMatchObject({
      id: "system:1",
      source: "system",
      name: "系统技能",
      content: "不可公开的系统提示词",
    });
    await expect(getSystemRoleSkillForUser("system:2"))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("hides cross-account personal existence and rejects unavailable system skills", async () => {
    fake.state.personals.push(row({ id: BigInt(3), authUserId: 8 }));
    fake.state.systems.push(row({ id: BigInt(2), status: "hidden" }));

    await expect(resolveRoleSkillForExecution({ authUserId: 7, publicId: "personal:3" }))
      .rejects.toMatchObject({ code: "not-found" } satisfies Partial<RoleSkillRepositoryError>);
    await expect(resolveRoleSkillForExecution({ authUserId: 7, publicId: "system:2" }))
      .rejects.toMatchObject({ code: "unavailable" } satisfies Partial<RoleSkillRepositoryError>);
  });

  it("uses optimistic revision checks for personal edits", async () => {
    fake.state.personals.push(row({ id: BigInt(3), authUserId: 7, revision: 2 }));

    await expect(updatePersonalRoleSkill({
      authUserId: 7,
      publicId: "personal:3",
      expectedRevision: 1,
      value: {
        name: "修改",
        summary: "简介",
        category: "商业广告",
        coverUrl: null,
        content: "正文",
        usageScenario: "商品图",
        usageGuide: "上传图片",
      },
    })).rejects.toMatchObject({ code: "conflict" } satisfies Partial<RoleSkillRepositoryError>);
  });

  it("rolls back a personal edit when replacing its workspace fails", async () => {
    fake.state.personals.push(row({ id: BigInt(3), authUserId: 7, revision: 2 }));
    workspaceStorage.replaceRoleSkillWorkspace.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(updatePersonalRoleSkill({
      authUserId: 7,
      publicId: "personal:3",
      expectedRevision: 2,
      value: {
        name: "修改",
        summary: "新简介",
        category: "商业广告",
        coverUrl: null,
        content: "新正文",
        usageScenario: "商品图",
        usageGuide: "上传图片",
      },
    })).rejects.toThrow("disk unavailable");
    expect(fake.state.personals[0]).toMatchObject({
      name: "技能",
      summary: "简介",
      content: "不可公开的系统提示词",
      revision: 2,
    });
  });

  it("rolls back a system edit when replacing its workspace fails", async () => {
    fake.state.systems.push(row({ id: BigInt(4), status: "published", revision: 3 }));
    workspaceStorage.replaceRoleSkillWorkspace.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(updateSystemRoleSkill({
      publicId: "system:4",
      expectedRevision: 3,
      status: "hidden",
      value: {
        name: "修改",
        summary: "新简介",
        category: "商业广告",
        coverUrl: null,
        content: "新正文",
        usageScenario: "商品图",
        usageGuide: "上传图片",
        mediaType: "image",
      },
    })).rejects.toThrow("disk unavailable");
    expect(fake.state.systems[0]).toMatchObject({
      name: "技能",
      summary: "简介",
      content: "不可公开的系统提示词",
      status: "published",
      revision: 3,
    });
  });

  it("persists an optional media type only for system Skills", async () => {
    const skill = await createSystemRoleSkill({
      status: "hidden",
      value: {
        name: "视频脚本",
        summary: "生成短视频脚本",
        category: "通用技能",
        coverUrl: null,
        content: "完整提示词",
        usageScenario: "短视频",
        usageGuide: "输入主题",
        mediaType: "video",
      },
    });

    expect(fake.state.systems[0]?.mediaType).toBe("video");
    expect(skill.mediaType).toBe("video");
  });
});
