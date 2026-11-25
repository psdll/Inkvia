import { beforeEach, describe, expect, it, vi } from "vitest";

type PromptRow = {
  id: bigint;
  authUserId: number;
  name: string;
  category: string;
  content: string;
  revision: number;
  legacyKey: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type BuiltinRow = Omit<PromptRow, "authUserId" | "legacyKey"> & {
  key: string;
};

const fake = vi.hoisted(() => {
  const state = {
    prompts: [] as PromptRow[],
    builtins: [] as BuiltinRow[],
    deletions: [] as Array<{ authUserId: number; builtinPromptPresetId: bigint; createdAt: Date }>,
    nextPromptId: BigInt(100),
    now: new Date("2026-07-30T08:00:00.000Z"),
  };

  const client = {
    promptPreset: {
      findMany: async ({ where }: {
        where: { authUserId: number; deletedAt: null };
      }) => state.prompts.filter(
        (row) => row.authUserId === where.authUserId && row.deletedAt === where.deletedAt,
      ),
      create: async ({ data }: {
        data: Pick<PromptRow, "authUserId" | "name" | "category" | "content">;
      }) => {
        const row: PromptRow = {
          id: state.nextPromptId++,
          ...data,
          revision: 1,
          legacyKey: null,
          deletedAt: null,
          createdAt: new Date(state.now),
          updatedAt: new Date(state.now),
        };
        state.prompts.push(row);
        return row;
      },
    },
    builtinPromptPreset: {
      findMany: async ({ where }: {
        where: {
          deletedAt: null;
          deletions?: { none: { authUserId: number } };
        };
      }) => state.builtins.filter((row) => (
        row.deletedAt === where.deletedAt
        && !state.deletions.some(
          (deletion) => (
            deletion.authUserId === where.deletions?.none.authUserId
            && deletion.builtinPromptPresetId === row.id
          ),
        )
      )),
    },
  };

  return { client, state };
});

vi.mock("@/lib/prisma", () => ({ default: fake.client }));

import {
  PromptPresetRepositoryError,
  createCustomPrompt,
  listEffectivePromptPresets,
} from "@/lib/prompt-presets/repository";

const at = (iso: string) => new Date(iso);

function custom(overrides: Partial<PromptRow> & Pick<PromptRow, "id" | "authUserId">): PromptRow {
  return {
    name: "自定义",
    category: "常用",
    content: "自定义内容",
    revision: 1,
    legacyKey: null,
    deletedAt: null,
    createdAt: at("2026-07-30T06:00:00.000Z"),
    updatedAt: at("2026-07-30T06:00:00.000Z"),
    ...overrides,
  };
}

function builtin(overrides: Partial<BuiltinRow> & Pick<BuiltinRow, "id" | "key">): BuiltinRow {
  return {
    name: "内置",
    category: "常用",
    content: "内置内容",
    revision: 1,
    deletedAt: null,
    createdAt: at("2026-07-30T06:00:00.000Z"),
    updatedAt: at("2026-07-30T06:00:00.000Z"),
    ...overrides,
  };
}

describe("prompt preset repository", () => {
  beforeEach(() => {
    fake.state.prompts.length = 0;
    fake.state.builtins.length = 0;
    fake.state.deletions.length = 0;
    fake.state.nextPromptId = BigInt(100);
    fake.state.now = at("2026-07-30T08:00:00.000Z");
  });

  it("returns active user customs and active undeleted builtins with source-prefixed DTO ids", async () => {
    fake.state.prompts.push(
      custom({ id: BigInt(4), authUserId: 1, updatedAt: at("2026-07-30T09:00:00.000Z") }),
      custom({ id: BigInt(5), authUserId: 2, name: "其他用户" }),
      custom({ id: BigInt(6), authUserId: 1, deletedAt: at("2026-07-30T07:00:00.000Z") }),
    );
    fake.state.builtins.push(
      builtin({ id: BigInt(2), key: "active", updatedAt: at("2026-07-30T08:00:00.000Z") }),
      builtin({ id: BigInt(3), key: "globally-deleted", deletedAt: at("2026-07-30T07:00:00.000Z") }),
    );
    fake.state.deletions.push({
      authUserId: 1,
      builtinPromptPresetId: BigInt(2),
      createdAt: at("2026-07-30T08:30:00.000Z"),
    });

    const userOne = await listEffectivePromptPresets({ authUserId: 1 });
    const userTwo = await listEffectivePromptPresets({ authUserId: 2 });

    expect(userOne.map(({ id }) => id)).toEqual(["custom:4"]);
    expect(userTwo.map(({ id }) => id)).toEqual(["builtin:2", "custom:5"]);
    expect(userTwo[0]).toEqual(expect.objectContaining({
      id: "builtin:2",
      source: "builtin",
      createdAt: "2026-07-30T06:00:00.000Z",
      updatedAt: "2026-07-30T08:00:00.000Z",
    }));
  });

  it("sorts by updatedAt descending and then public id ascending", async () => {
    const tiedAt = at("2026-07-30T10:00:00.000Z");
    fake.state.prompts.push(
      custom({ id: BigInt(2), authUserId: 1, updatedAt: tiedAt }),
      custom({ id: BigInt(1), authUserId: 1, updatedAt: tiedAt }),
    );
    fake.state.builtins.push(
      builtin({ id: BigInt(9), key: "older", updatedAt: at("2026-07-30T09:00:00.000Z") }),
      builtin({ id: BigInt(3), key: "tied", updatedAt: tiedAt }),
    );

    const result = await listEffectivePromptPresets({ authUserId: 1 });

    expect(result.map(({ id }) => id)).toEqual([
      "builtin:3",
      "custom:1",
      "custom:2",
      "builtin:9",
    ]);
  });

  it("normalizes custom prompt input before persisting", async () => {
    const result = await createCustomPrompt({
      authUserId: 1,
      value: {
        name: "  我的提示词  ",
        category: "  新分类  ",
        content: "  完整内容  ",
      },
    });

    expect(result).toEqual(expect.objectContaining({
      id: "custom:100",
      name: "我的提示词",
      category: "新分类",
      content: "完整内容",
      source: "custom",
      revision: 1,
    }));
    expect(fake.state.prompts).toEqual([
      expect.objectContaining({
        authUserId: 1,
        name: "我的提示词",
        category: "新分类",
        content: "完整内容",
      }),
    ]);
  });

  it("exposes a typed invalid error for invalid custom input", async () => {
    await expect(createCustomPrompt({
      authUserId: 1,
      value: { name: "名称", category: "   ", content: "内容" },
    })).rejects.toMatchObject({ code: "invalid" } satisfies Partial<PromptPresetRepositoryError>);
    expect(fake.state.prompts).toHaveLength(0);
  });
});
