import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
  getRoleSkillFeatureBinding,
  getRoleSkillFeatureKeysForSkill,
  saveRoleSkillFeatureBindings,
} from "@/lib/role-skills/feature-bindings";
import { LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY } from "@/lib/role-skills/features";

const rows = new Map<string, string>();
const client = {
  appSetting: {
    findUnique: vi.fn(async ({ where }: any) => {
      const value = rows.get(where.key);
      return value === undefined ? null : { key: where.key, value };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      rows.set(where.key, rows.has(where.key) ? update.value : create.value);
      return { key: where.key, value: rows.get(where.key) };
    }),
    deleteMany: vi.fn(async ({ where }: any) => ({
      count: rows.delete(where.key) ? 1 : 0,
    })),
  },
} as any;

describe("role Skill feature bindings", () => {
  beforeEach(() => {
    rows.clear();
    vi.clearAllMocks();
  });

  it("assigns one Live default and reports it only on the current system Skill", async () => {
    await saveRoleSkillFeatureBindings(
      "system:3",
      [LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY],
      client,
    );

    await expect(getRoleSkillFeatureBinding(
      LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY,
      client,
    )).resolves.toBe("system:3");
    await expect(getRoleSkillFeatureKeysForSkill("system:3", client)).resolves.toEqual([
      LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY,
    ]);
    await expect(getRoleSkillFeatureKeysForSkill("system:4", client)).resolves.toEqual([]);
  });

  it("reassigns the Live default without letting the previous Skill clear it", async () => {
    await saveRoleSkillFeatureBindings(
      "system:3",
      [LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY],
      client,
    );
    await saveRoleSkillFeatureBindings(
      "system:4",
      [LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY],
      client,
    );
    await saveRoleSkillFeatureBindings("system:3", [], client);

    await expect(getRoleSkillFeatureBinding(
      LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY,
      client,
    )).resolves.toBe("system:4");
  });
});
