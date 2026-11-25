import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
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
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const fake = vi.hoisted(() => {
  const systems: Row[] = [];
  const personals: Row[] = [];
  return {
    systems,
    personals,
    db: {
      systemRoleSkill: {
        findMany: vi.fn(async ({ where }: any) => systems.filter((row) => (
          row.status === where.status && row.deletedAt === where.deletedAt
        ))),
      },
      userRoleSkill: {
        findMany: vi.fn(async ({ where }: any) => personals.filter((row) => (
          row.authUserId === where.authUserId && row.deletedAt === where.deletedAt
        ))),
      },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ default: fake.db }));

import { listRoleSkillsForAdminAudit } from "@/lib/role-skills/repository";

function row(id: number, overrides: Partial<Row>): Row {
  return {
    id: BigInt(id),
    name: `技能 ${id}`,
    summary: "简介",
    category: "商业广告",
    coverUrl: null,
    content: `完整正文 ${id}`,
    usageScenario: "商品图",
    usageGuide: "上传图片",
    revision: 1,
    deletedAt: null,
    createdAt: new Date("2026-08-05T08:00:00.000Z"),
    updatedAt: new Date("2026-08-05T08:00:00.000Z"),
    ...overrides,
  };
}

describe("administrator user Skill audit", () => {
  beforeEach(() => {
    fake.systems.length = 0;
    fake.personals.length = 0;
    vi.clearAllMocks();
  });

  it("returns full published system content and only the selected account personal content", async () => {
    fake.systems.push(
      row(1, { status: "published" }),
      row(2, { status: "hidden" }),
    );
    fake.personals.push(
      row(3, { authUserId: 7 }),
      row(4, { authUserId: 8 }),
    );

    const skills = await listRoleSkillsForAdminAudit({ authUserId: 7 });

    expect(skills.map((skill) => skill.id).sort()).toEqual(["personal:3", "system:1"]);
    expect(Object.fromEntries(skills.map((skill) => [skill.id, skill.content]))).toEqual({
      "system:1": "完整正文 1",
      "personal:3": "完整正文 3",
    });
    expect(fake.db.userRoleSkill.findMany).toHaveBeenCalledWith({
      where: { authUserId: 7, deletedAt: null },
      include: { authUser: { select: { username: true } } },
    });
  });

  it("returns only system skills when the selected identity has no account", async () => {
    fake.systems.push(row(1, { status: "published" }));
    fake.personals.push(row(3, { authUserId: 7 }));

    await expect(listRoleSkillsForAdminAudit({ authUserId: null }))
      .resolves.toMatchObject([{ id: "system:1", source: "system", content: "完整正文 1" }]);
    expect(fake.db.userRoleSkill.findMany).not.toHaveBeenCalled();
  });

  it("loads the audit data lazily through the protected existing user route", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/admin/user/route.ts"), "utf8");

    expect(route).toContain("requireAdminRequest(req)");
    expect(route).toContain('section === "full" || section === "skills"');
    expect(route).toContain("listRoleSkillsForAdminAudit({ authUserId: scopeInfo.authUserId })");
    expect(route).toContain("roleSkills,");
  });
});
