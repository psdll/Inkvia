import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rows: Array<Record<string, any>> = [];
  let nextId = BigInt(1);
  return {
    rows,
    resetRows() {
      rows.length = 0;
      nextId = BigInt(1);
    },
    ensureLegacyBuiltinPromptsMigrated: vi.fn(async () => undefined),
    ensureCanvasPromptSeeds: vi.fn(async () => undefined),
    promptPresetUpdateMany: vi.fn(),
    builtinFindMany: vi.fn(async () =>
      rows
        .filter((row) => row.deletedAt === null)
        .sort((left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime()
          || left.id.toString().localeCompare(right.id.toString()),
        ),
    ),
    builtinCreate: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date("2026-07-30T00:00:00.000Z");
      const row: Record<string, any> = {
        id: nextId++,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...data,
      };
      rows.push(row);
      return row;
    }),
    builtinUpdateManyAndReturn: vi.fn(async ({
      where,
      data,
    }: {
      where: { id: bigint; revision: number; deletedAt: null };
      data: Record<string, any>;
    }) => {
      const row = rows.find(
        (candidate) =>
          candidate.id === where.id
          && candidate.revision === where.revision
          && candidate.deletedAt === null,
      );
      if (!row) return [];
      Object.assign(row, data, {
        revision: row.revision + Number(data.revision?.increment || 0),
        updatedAt: new Date("2026-07-30T01:00:00.000Z"),
      });
      return [row];
    }),
    builtinFindFirst: vi.fn(async ({ where }: { where: { id: bigint } }) =>
      rows.find((row) => row.id === where.id && row.deletedAt === null) || null,
    ),
  };
});

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/prompt-presets/migration", () => ({
  ensureLegacyBuiltinPromptsMigrated: mocks.ensureLegacyBuiltinPromptsMigrated,
}));

vi.mock("@/lib/prompt-presets/builtin-seeds", () => ({
  ensureCanvasPromptSeeds: mocks.ensureCanvasPromptSeeds,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    builtinPromptPreset: {
      findMany: mocks.builtinFindMany,
      create: mocks.builtinCreate,
      updateManyAndReturn: mocks.builtinUpdateManyAndReturn,
      findFirst: mocks.builtinFindFirst,
    },
    promptPreset: {
      updateMany: mocks.promptPresetUpdateMany,
    },
  },
}));

import {
  DELETE,
  GET,
  PATCH,
  POST,
} from "@/app/api/admin/presets/route";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://test/api/admin/presets", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

describe("administrator global builtin prompt presets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetRows();
    mocks.ensureLegacyBuiltinPromptsMigrated.mockResolvedValue(undefined);
    mocks.ensureCanvasPromptSeeds.mockResolvedValue(undefined);
  });

  it("lists active database builtins after ensuring legacy and canvas seeds", async () => {
    await mocks.builtinCreate({
      data: {
        key: "legacy:image:1",
        name: "图片内置",
        category: "图片",
        content: "正文",
      },
    });
    const deleted = await mocks.builtinCreate({
      data: {
        key: "legacy:video:2",
        name: "已删除",
        category: "视频",
        content: "正文",
      },
    });
    deleted.deletedAt = new Date("2026-07-30T02:00:00.000Z");

    const response = await GET(new Request("http://test/api/admin/presets"));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      presets: [
        expect.objectContaining({
          id: "builtin:1",
          source: "builtin",
          category: "图片",
          revision: 1,
        }),
      ],
    });
    expect(mocks.ensureLegacyBuiltinPromptsMigrated).toHaveBeenCalledOnce();
    expect(mocks.ensureCanvasPromptSeeds).toHaveBeenCalledOnce();
  });

  it("still lists stored builtins when a best-effort seed step fails", async () => {
    await mocks.builtinCreate({
      data: {
        key: "admin:existing",
        name: "已有提示词",
        category: "图片",
        content: "正文",
      },
    });
    mocks.ensureLegacyBuiltinPromptsMigrated.mockRejectedValueOnce(
      new Error("legacy seed unavailable"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request("http://test/api/admin/presets"));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      presets: [expect.objectContaining({ id: "builtin:1", name: "已有提示词" })],
    });
    expect(mocks.ensureCanvasPromptSeeds).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[prompt-presets] read preparation failed at legacy-builtin-migration",
      expect.any(Error),
    );
    error.mockRestore();
  });

  it("creates a database builtin with a stable admin key and required category", async () => {
    const response = await POST(
      jsonRequest("POST", {
        name: "  管理员内置  ",
        category: "  电商  ",
        content: "  正文  ",
      }),
    );

    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.preset).toMatchObject({
      id: "builtin:1",
      name: "管理员内置",
      category: "电商",
      content: "正文",
      source: "builtin",
      revision: 1,
    });
    expect(String(mocks.rows[0].key)).toMatch(/^admin:[0-9a-f-]{36}$/);

    const missingCategory = await POST(
      jsonRequest("POST", { name: "标题", content: "正文" }),
    );
    expect(missingCategory.status).toBe(400);
  });

  it.each([
    ["GET query", () => GET(new Request("http://test/api/admin/presets?scope=image"))],
    [
      "POST body",
      () =>
        POST(
          jsonRequest("POST", {
            scope: "image",
            name: "标题",
            category: "分类",
            content: "正文",
          }),
        ),
    ],
    [
      "PATCH body",
      () =>
        PATCH(
          jsonRequest("PATCH", {
            scope: "image",
            presetId: "builtin:1",
            expectedRevision: 1,
            name: "标题",
            category: "分类",
            content: "正文",
          }),
        ),
    ],
    [
      "DELETE body",
      () =>
        DELETE(
          jsonRequest("DELETE", {
            scope: "image",
            presetId: "builtin:1",
            expectedRevision: 1,
          }),
        ),
    ],
  ])("rejects retired scope in %s", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(400);
  });

  it("atomically updates by public ID and expected revision", async () => {
    await mocks.builtinCreate({
      data: {
        key: "admin:test",
        name: "旧标题",
        category: "旧分类",
        content: "旧正文",
      },
    });

    const updated = await PATCH(
      jsonRequest("PATCH", {
        presetId: "builtin:1",
        expectedRevision: 1,
        name: "新标题",
        category: "新分类",
        content: "新正文",
      }),
    );
    expect(updated.status).toBe(200);
    expect((await json(updated)).preset).toMatchObject({
      id: "builtin:1",
      name: "新标题",
      revision: 2,
    });

    const stale = await PATCH(
      jsonRequest("PATCH", {
        presetId: "builtin:1",
        expectedRevision: 1,
        name: "过期修改",
        category: "分类",
        content: "正文",
      }),
    );
    expect(stale.status).toBe(409);

    const missing = await PATCH(
      jsonRequest("PATCH", {
        presetId: "builtin:99",
        expectedRevision: 1,
        name: "不存在",
        category: "分类",
        content: "正文",
      }),
    );
    expect(missing.status).toBe(404);
  });

  it("soft-deletes a global builtin without touching independent customs", async () => {
    await mocks.builtinCreate({
      data: {
        key: "admin:test",
        name: "全局内置",
        category: "分类",
        content: "正文",
      },
    });

    const stale = await DELETE(
      jsonRequest("DELETE", {
        presetId: "builtin:1",
        expectedRevision: 2,
      }),
    );
    expect(stale.status).toBe(409);
    expect(mocks.rows[0].deletedAt).toBeNull();

    const response = await DELETE(
      jsonRequest("DELETE", {
        presetId: "builtin:1",
        expectedRevision: 1,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.rows[0].deletedAt).toBeInstanceOf(Date);
    expect(mocks.rows[0].revision).toBe(2);
    expect(mocks.promptPresetUpdateMany).not.toHaveBeenCalled();
  });

  it("removes the module picker and uses category input, suggestions, and shared tokens", () => {
    const source = readFileSync(
      "components/admin/BuiltinPresetsSection.tsx",
      "utf8",
    );

    expect(source).not.toContain("SCOPE_OPTIONS");
    expect(source).not.toContain("FrostedSelect");
    expect(source).not.toContain("选择功能模块");
    expect(source).toContain("category");
    expect(source).toContain("categorySuggestions");
    expect(source).not.toMatch(/\b(?:blue|white|black|zinc|slate)-/);
    expect(source).toContain("var(--primary-bg)");
  });
});
