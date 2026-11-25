import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  let migrationState: Record<string, unknown> | null = null;
  let customPromptCount = 2;
  let builtinDeletionCount = 1;
  let failPromptDelete = false;
  let registeredDeletedCount = 3;
  return {
    callOrder,
    get migrationState() {
      return migrationState;
    },
    set migrationState(value: Record<string, unknown> | null) {
      migrationState = value;
    },
    get customPromptCount() {
      return customPromptCount;
    },
    set customPromptCount(value: number) {
      customPromptCount = value;
    },
    get builtinDeletionCount() {
      return builtinDeletionCount;
    },
    set builtinDeletionCount(value: number) {
      builtinDeletionCount = value;
    },
    get failPromptDelete() {
      return failPromptDelete;
    },
    set failPromptDelete(value: boolean) {
      failPromptDelete = value;
    },
    get registeredDeletedCount() {
      return registeredDeletedCount;
    },
    set registeredDeletedCount(value: number) {
      registeredDeletedCount = value;
    },
    scopeInfo: {
      requestedUserId: "7",
      authUserId: 7 as number | null,
      linkedUserIds: ["7"],
      linkedGuestUserIds: [],
      presetUserIds: ["7"],
      generationWhere: { authUserId: 7 },
      logWhere: { userId: "7" },
    },
    pathExists: vi.fn(async () => true),
    readJson: vi.fn(),
    ensureLegacyUserPromptsMigrated: vi.fn(async () => {
      callOrder.push("user-migration");
    }),
    ensureLegacyBuiltinPromptsMigrated: vi.fn(async () => {
      callOrder.push("builtin-migration");
    }),
    ensureCanvasPromptSeeds: vi.fn(async () => {
      callOrder.push("canvas-seeds");
    }),
    listEffectivePromptPresets: vi.fn(async (): Promise<any[]> => {
      callOrder.push("effective-list");
      return [];
    }),
    deletePromptForUser: vi.fn(async () => undefined),
    scanLegacyPromptPresets: vi.fn(async () => ({
      version: 1,
      digest: "legacy-digest",
      fileCount: 2,
      validCount: 2,
      invalidCount: 0,
      duplicateIds: [],
      duplicateNames: [],
      rows: [],
    })),
    legacyImport: vi.fn(),
    logCreate: vi.fn(async () => ({})),
    advisoryLock: vi.fn(async () => {
      callOrder.push("lock");
      return [];
    }),
    userBuiltinDeleteMany: vi.fn(async () => {
      callOrder.push("builtin-delete");
      const count = builtinDeletionCount;
      builtinDeletionCount = 0;
      return { count };
    }),
    migrationDeleteMany: vi.fn(async () => {
      callOrder.push("state-delete");
      migrationState = null;
      return { count: 1 };
    }),
    migrationUpsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
      callOrder.push("marker");
      migrationState = create;
      return create;
    }),
    promptDeleteMany: vi.fn(async () => {
      callOrder.push("prompt-delete");
      if (failPromptDelete) throw new Error("injected prompt delete failure");
      const count = customPromptCount;
      customPromptCount = 0;
      return { count };
    }),
    promptPresetCount: vi.fn(async () => registeredDeletedCount),
  };
});

vi.mock("fs-extra", () => ({
  default: {
    pathExists: mocks.pathExists,
    readJson: mocks.readJson,
  },
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/admin-user-scope", () => ({
  resolveAdminUserScope: vi.fn(async () => mocks.scopeInfo),
}));

vi.mock("@/lib/public-path", () => ({
  resolvePublicPath: (...parts: string[]) => `C:/public/${parts.join("/")}`,
  resolvePublicDir: () => "C:/public",
}));

vi.mock("@/lib/prompt-presets/migration", () => ({
  ensureLegacyUserPromptsMigrated: mocks.ensureLegacyUserPromptsMigrated,
  ensureLegacyBuiltinPromptsMigrated: mocks.ensureLegacyBuiltinPromptsMigrated,
  scanLegacyPromptPresets: mocks.scanLegacyPromptPresets,
}));

vi.mock("@/lib/prompt-presets/builtin-seeds", () => ({
  ensureCanvasPromptSeeds: mocks.ensureCanvasPromptSeeds,
}));

vi.mock("@/lib/prompt-presets/repository", () => ({
  PromptPresetRepositoryError: class PromptPresetRepositoryError extends Error {
    constructor(
      public readonly code: "invalid" | "not-found" | "conflict",
      message: string,
    ) {
      super(message);
    }
  },
  listEffectivePromptPresets: mocks.listEffectivePromptPresets,
  deletePromptForUser: mocks.deletePromptForUser,
}));

vi.mock("@/lib/prisma", () => {
  const modelCache = new Map<string, object>();
  const model = (modelName: string) => {
    const cached = modelCache.get(modelName);
    if (cached) return cached;
    const methodCache = new Map<string, ReturnType<typeof vi.fn>>();
    const modelTarget =
      modelName === "log"
        ? { create: mocks.logCreate }
        : modelName === "promptPreset"
          ? { count: mocks.promptPresetCount }
          : {};
    const value = new Proxy(
      modelTarget,
      {
        get(target, property) {
          if (property in target) {
            return (target as Record<PropertyKey, unknown>)[property];
          }
          const methodName = String(property);
          const existing = methodCache.get(methodName);
          if (existing) return existing;
          const method = vi.fn(async () => {
            if (methodName === "findMany" || methodName === "groupBy") return [];
            if (methodName === "count") return 0;
            if (methodName === "findUnique" || methodName === "findFirst") {
              return null;
            }
            if (methodName === "aggregate") {
              return {
                _sum: {
                  amount: 0,
                  sizeBytes: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                },
                _count: { _all: 0 },
                _min: { createdAt: null },
                _max: { createdAt: null, finishedAt: null },
                _avg: { latencyMs: 0 },
              };
            }
            return { count: 0 };
          });
          methodCache.set(methodName, method);
          return method;
        },
      },
    );
    modelCache.set(modelName, value);
    return value;
  };
  const transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        migrationState: mocks.migrationState,
        customPromptCount: mocks.customPromptCount,
        builtinDeletionCount: mocks.builtinDeletionCount,
      };
      try {
        return await callback({
          $queryRaw: mocks.advisoryLock,
          userBuiltinPromptDeletion: { deleteMany: mocks.userBuiltinDeleteMany },
          promptPresetMigrationState: {
            deleteMany: mocks.migrationDeleteMany,
            upsert: mocks.migrationUpsert,
          },
          promptPreset: { deleteMany: mocks.promptDeleteMany },
        });
      } catch (error) {
        mocks.migrationState = snapshot.migrationState;
        mocks.customPromptCount = snapshot.customPromptCount;
        mocks.builtinDeletionCount = snapshot.builtinDeletionCount;
        throw error;
      }
    },
  );
  return {
    default: new Proxy(
      { $transaction: transaction },
      {
        get(target, property) {
          if (property in target) {
            return (target as Record<PropertyKey, unknown>)[property];
          }
          return model(String(property));
        },
      },
    ),
  };
});

import { GET as getAdminUser } from "@/app/api/admin/user/route";
import { POST as deleteUserPreset } from "@/app/api/admin/user/presets/delete-item/route";
import { POST as purgeUserPresets } from "@/app/api/admin/user/presets/purge/route";
import UserPresetsPanel from "@/components/admin/UserPresetsPanel";

const timestamp = "2026-07-30T00:00:00.000Z";

function dto(
  id: string,
  source: "custom" | "builtin",
  name: string,
) {
  return {
    id,
    name,
    category: "测试",
    content: `${name}正文`,
    source,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadAdminPresetsThroughRoute() {
  const query = new URLSearchParams({
    section: "presets",
    userId: mocks.scopeInfo.requestedUserId,
  });
  if (typeof mocks.scopeInfo.authUserId === "number") {
    query.set("authUserId", String(mocks.scopeInfo.authUserId));
  }
  const response = await getAdminUser(
    new NextRequest(`http://test/api/admin/user?${query}`),
  );
  expect(response.status).toBe(200);
  return await response.json() as {
    presets: any[];
    presetDeletedCount: number;
  };
}

describe("administrator unified user prompt presets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    mocks.migrationState = null;
    mocks.customPromptCount = 2;
    mocks.builtinDeletionCount = 1;
    mocks.failPromptDelete = false;
    mocks.registeredDeletedCount = 3;
    mocks.scopeInfo.authUserId = 7;
    mocks.scopeInfo.requestedUserId = "7";
    mocks.scopeInfo.linkedUserIds = ["7"];
    mocks.scopeInfo.presetUserIds = ["7"];
    mocks.readJson.mockResolvedValue([]);
    mocks.listEffectivePromptPresets.mockImplementation(async () => {
      mocks.callOrder.push("effective-list");
      return [];
    });
    mocks.ensureLegacyUserPromptsMigrated.mockImplementation(async () => {
      mocks.callOrder.push("user-migration");
      if (!mocks.migrationState) mocks.legacyImport();
    });
  });

  it("migrates registered sources in order and returns one effective DTO array", async () => {
    const presets = [
      dto("builtin:1", "builtin", "全局内置"),
      dto("custom:2", "custom", "脱离内置后的自定义"),
    ];
    mocks.scopeInfo.presetUserIds = ["7", "historical-7"];
    mocks.listEffectivePromptPresets.mockImplementation(async () => {
      mocks.callOrder.push("effective-list");
      return presets;
    });

    const body = await loadAdminPresetsThroughRoute();
    const result = body.presets;

    expect(result).toEqual(presets);
    expect(Array.isArray(result)).toBe(true);
    expect(body.presetDeletedCount).toBe(3);
    expect(mocks.promptPresetCount).toHaveBeenCalledWith({
      where: {
        authUserId: 7,
        deletedAt: { not: null },
      },
    });
    expect(mocks.ensureLegacyUserPromptsMigrated).toHaveBeenCalledWith({
      authUserId: 7,
      presetUserIds: ["7", "historical-7"],
    });
    expect(mocks.callOrder).toEqual([
      "user-migration",
      "builtin-migration",
      "canvas-seeds",
      "effective-list",
    ]);
  });

  it("flattens only the selected guest's legacy scopes as read-only custom DTOs", async () => {
    mocks.scopeInfo.authUserId = null;
    mocks.scopeInfo.requestedUserId = "guest-a";
    mocks.scopeInfo.presetUserIds = ["guest-a"];
    mocks.readJson.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("/guest-a/image.json")) {
        return [
          {
            id: "same-id",
            name: "访客图片",
            content: "图片正文",
            createdAt: timestamp,
          },
        ];
      }
      if (filePath.endsWith("/guest-a/video.json")) {
        return [
          {
            id: "same-id",
            name: "访客视频",
            groupName: "视频组",
            content: "视频正文",
            updatedAt: timestamp,
          },
          {
            id: "deleted-id",
            name: "已删除访客项",
            groupName: "视频组",
            content: "已删除正文",
            deletedAt: timestamp,
          },
        ];
      }
      throw new Error(`unexpected guest path: ${filePath}`);
    });

    const body = await loadAdminPresetsThroughRoute();
    const result = body.presets;

    expect(result).toHaveLength(2);
    expect(body.presetDeletedCount).toBe(1);
    expect(result.map((item) => item.id)).toEqual([
      "legacy-readonly:guest-a:image:same-id",
      "legacy-readonly:guest-a:video:same-id",
    ]);
    expect(result[0]).toMatchObject({
      category: "图片编辑",
      source: "custom",
      revision: 1,
    });
    expect(result[1]).toMatchObject({ category: "视频组", source: "custom" });
    expect(mocks.readJson.mock.calls.every(([filePath]) =>
      String(filePath).includes("/guest-a/"),
    )).toBe(true);
    expect(mocks.ensureLegacyUserPromptsMigrated).not.toHaveBeenCalled();
    expect(mocks.listEffectivePromptPresets).not.toHaveBeenCalled();
  });

  it("deletes a public builtin only for the explicitly resolved registered user", async () => {
    const response = await deleteUserPreset(
      jsonRequest("http://test/api/admin/user/presets/delete-item", {
        adminKey: "auth:7",
        presetId: "builtin:8",
        expectedRevision: 3,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.deletePromptForUser).toHaveBeenCalledWith({
      authUserId: 7,
      publicId: "builtin:8",
      expectedRevision: 3,
    });
    expect(mocks.logCreate).toHaveBeenCalledOnce();

    mocks.scopeInfo.authUserId = null;
    const guestResponse = await deleteUserPreset(
      jsonRequest("http://test/api/admin/user/presets/delete-item", {
        adminKey: "guest:guest-a",
        presetId: "legacy-readonly:guest-a:image:same-id",
        expectedRevision: 1,
      }),
    );
    expect(guestResponse.status).toBe(400);
    expect(mocks.deletePromptForUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "legacy userId and authUserId",
      body: { userId: "7", authUserId: 7 },
    },
    {
      label: "adminKey mixed with userId",
      body: { adminKey: "auth:7", userId: "7" },
    },
    {
      label: "adminKey mixed with authUserId",
      body: { adminKey: "auth:7", authUserId: 7 },
    },
    {
      label: "retired scope",
      body: { adminKey: "auth:7", scope: "image" },
    },
  ])("rejects $label identity payloads", async ({ body }) => {
    const response = await deleteUserPreset(
      jsonRequest("http://test/api/admin/user/presets/delete-item", {
        ...body,
        presetId: "custom:8",
        expectedRevision: 1,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.deletePromptForUser).not.toHaveBeenCalled();
  });

  it("requires expectedRevision when an administrator deletes a builtin", async () => {
    const response = await deleteUserPreset(
      jsonRequest("http://test/api/admin/user/presets/delete-item", {
        adminKey: "auth:7",
        presetId: "builtin:8",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.deletePromptForUser).not.toHaveBeenCalled();
  });

  it("purges database rows but preserves a completion marker for the current legacy digest", async () => {
    const response = await purgeUserPresets(
      jsonRequest("http://test/api/admin/user/presets/purge", {
        adminKey: "auth:7",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.scanLegacyPromptPresets).toHaveBeenCalledWith({
      publicDir: "C:/public",
      presetUserIds: ["7"],
    });
    expect(mocks.userBuiltinDeleteMany).toHaveBeenCalledWith({
      where: { authUserId: 7 },
    });
    expect(mocks.promptDeleteMany).toHaveBeenCalledWith({
      where: { authUserId: 7 },
    });
    expect(mocks.migrationUpsert).toHaveBeenCalledWith({
      where: { subjectKey: "user:7:user-json" },
      create: expect.objectContaining({
        subjectKey: "user:7:user-json",
        authUserId: 7,
        source: "user-json",
        version: 1,
        digest: "legacy-digest",
        rowCount: 0,
      }),
      update: expect.any(Object),
    });
    expect(mocks.advisoryLock).toHaveBeenCalledOnce();
    expect((mocks.advisoryLock.mock.calls[0] as unknown[])[1]).toBe(
      "user:7:user-json",
    );
    expect(mocks.callOrder.slice(0, 5)).toEqual([
      "lock",
      "builtin-delete",
      "state-delete",
      "prompt-delete",
      "marker",
    ]);

    mocks.listEffectivePromptPresets.mockResolvedValue([
      dto("builtin:1", "builtin", "恢复的全局内置"),
    ]);
    const afterPurge = await loadAdminPresetsThroughRoute();
    expect(afterPurge.presets.map((item) => item.id)).toEqual(["builtin:1"]);
    expect(mocks.legacyImport).not.toHaveBeenCalled();
  });

  it("rolls back purge changes when a deletion fails after the advisory lock", async () => {
    const originalState = {
      subjectKey: "user:7:user-json",
      digest: "previous-digest",
    };
    mocks.migrationState = originalState;
    mocks.customPromptCount = 2;
    mocks.builtinDeletionCount = 1;
    mocks.failPromptDelete = true;

    await expect(
      purgeUserPresets(
        jsonRequest("http://test/api/admin/user/presets/purge", {
          adminKey: "auth:7",
        }),
      ),
    ).rejects.toThrow("injected prompt delete failure");

    expect(mocks.callOrder.slice(0, 4)).toEqual([
      "lock",
      "builtin-delete",
      "state-delete",
      "prompt-delete",
    ]);
    expect(mocks.migrationState).toEqual(originalState);
    expect(mocks.customPromptCount).toBe(2);
    expect(mocks.builtinDeletionCount).toBe(1);
    expect(mocks.migrationUpsert).not.toHaveBeenCalled();
  });

  it.each([
    { userId: "7", authUserId: 7 },
    { adminKey: "auth:7", userId: "7" },
    { adminKey: "auth:7", authUserId: 7 },
    { adminKey: "auth:7", scope: "image" },
    { adminKey: "guest:guest-a" },
  ])("rejects invalid purge target payload %#", async (identity) => {
    const response = await purgeUserPresets(
      jsonRequest("http://test/api/admin/user/presets/purge", identity),
    );
    expect(response.status).toBe(400);
    expect(mocks.advisoryLock).not.toHaveBeenCalled();
  });

  it("renders one source-labelled grid and hides deletion for guest compatibility IDs", () => {
    const html = renderToStaticMarkup(
      React.createElement(UserPresetsPanel, {
        presets: [
          dto("builtin:1", "builtin", "内置项"),
          dto("custom:2", "custom", "自定义项"),
          {
            ...dto("legacy-readonly:guest-a:image:3", "custom", "访客只读项"),
            category: "图片编辑",
          },
        ],
        onRequestDelete: vi.fn(),
      }),
    );

    expect(html).toContain("内置");
    expect(html).toContain("用户自定义");
    expect(html).toContain("访客只读项");
    expect(html).toContain("只读");
    expect(html.match(/aria-label="删除/g)).toHaveLength(2);

    const source = readFileSync(
      "components/admin/UserPresetsPanel.tsx",
      "utf8",
    );
    expect(source).not.toContain("PresetScope");
    expect(source).not.toContain("bg-blue");
    expect(source).not.toContain("text-white");
  });

  it("uses single-array admin page types and revisioned scope-free delete payloads", () => {
    const source = readFileSync("app/admin/page.tsx", "utf8");

    expect(source).toContain("presets: PromptPresetDto[]");
    expect(source).toContain("presetDeletedCount: number");
    expect(source).not.toContain("Record<PresetScope");
    expect(source).toContain('preset.source === "custom"');
    expect(source).toContain("payload?.presetDeletedCount");
    expect(source).toContain("adminKey: activeUserItem.adminKey");
    expect(source).toContain("expectedRevision: confirmAction.expectedRevision");
    expect(source).not.toContain("scope: confirmAction.scope");
    expect(source).toContain("将删除用户自定义提示词和个人内置隐藏记录");
    expect(source).toContain("恢复当前全局内置提示词");
  });
});
