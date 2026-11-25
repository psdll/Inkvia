import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("unified prompt preset data lifecycle", () => {
  it("exports the version 2 contract with complete custom history and stable builtin keys", async () => {
    const exportBuilder = await import("@/lib/admin/user-export-builder") as any;
    expect(typeof exportBuilder.buildPromptPresetArchiveV2).toBe("function");
    if (typeof exportBuilder.buildPromptPresetArchiveV2 !== "function") return;

    const promptPresetFindMany = vi.fn(async () => [
      {
        id: BigInt(11),
        authUserId: 7,
        name: "普通自定义",
        category: "营销",
        content: "正文 A",
        revision: 3,
        legacyKey: null,
        originBuiltinId: null,
        source: "custom",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
      },
      {
        id: BigInt(12),
        authUserId: 7,
        name: "从内置编辑",
        category: "写作",
        content: "正文 B",
        revision: 5,
        legacyKey: "forbidden-source-link",
        originBuiltinId: BigInt(99),
        source: "builtin",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        deletedAt: new Date("2026-02-03T00:00:00.000Z"),
      },
    ]);
    const deletionFindMany = vi.fn(async () => [
      { builtinPromptPreset: { key: "canvas:portrait-v1" } },
    ]);

    const archive = await exportBuilder.buildPromptPresetArchiveV2(
      {
        promptPreset: { findMany: promptPresetFindMany },
        userBuiltinPromptDeletion: { findMany: deletionFindMany },
      },
      7,
    );

    expect(promptPresetFindMany).toHaveBeenCalledWith({
      where: { authUserId: 7 },
      orderBy: { id: "asc" },
    });
    expect(archive).toEqual({
      version: 2,
      customPrompts: [
        {
          id: "11",
          name: "普通自定义",
          category: "营销",
          content: "正文 A",
          revision: 3,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          deletedAt: null,
        },
        {
          id: "12",
          name: "从内置编辑",
          category: "写作",
          content: "正文 B",
          revision: 5,
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-02T00:00:00.000Z",
          deletedAt: "2026-02-03T00:00:00.000Z",
        },
      ],
      deletedBuiltinKeys: ["canvas:portrait-v1"],
    });
    expect(JSON.stringify(archive)).not.toContain("originBuiltinId");
    expect(JSON.stringify(archive)).not.toContain("authUserId");
    expect(JSON.stringify(archive)).not.toContain("legacyKey");
    expect(JSON.stringify(archive)).not.toContain('"source"');
  });

  it("restores version 2 prompts for the target user and warns for unknown builtin keys", async () => {
    const importRunner = await import("@/lib/admin/user-import-runner") as any;
    expect(typeof importRunner.restorePromptPresetArchiveV2).toBe("function");
    if (typeof importRunner.restorePromptPresetArchiveV2 !== "function") return;

    const calls: string[] = [];
    const promptCreate = vi.fn(async ({ data }: any) => {
      calls.push("custom");
      return { ...data, id: BigInt(101) };
    });
    const promptFindUnique = vi.fn(async () => {
      calls.push("custom-lookup");
      return null;
    });
    const builtinFindMany = vi.fn(async () => {
      calls.push("builtin-lookup");
      return [{ id: BigInt(501), key: "canvas:portrait-v1" }];
    });
    const deletionUpsert = vi.fn(async () => {
      calls.push("builtin-delete");
      return {};
    });
    const warnings: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        calls.push("lock");
        return [];
      }),
      promptPreset: { findUnique: promptFindUnique, create: promptCreate },
      builtinPromptPreset: { findMany: builtinFindMany },
      userBuiltinPromptDeletion: { upsert: deletionUpsert },
      promptPresetMigrationState: { upsert: vi.fn() },
    };

    const result = await importRunner.restorePromptPresetArchiveV2({
      tx,
      targetAuthUserId: 42,
      sourceArchiveUserId: 7,
      archive: {
        version: 2,
        customPrompts: [{
          id: "11",
          authUserId: 7,
          originBuiltinId: "99",
          legacyKey: "forbidden-source-link",
          source: "builtin",
          name: "从内置编辑",
          category: "写作",
          content: "正文",
          revision: 4,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          deletedAt: null,
        }],
        deletedBuiltinKeys: ["canvas:portrait-v1", "missing:key"],
      },
      warnings,
    });

    expect(calls).toEqual([
      "lock",
      "custom-lookup",
      "custom",
      "builtin-lookup",
      "builtin-delete",
    ]);
    expect(promptFindUnique).toHaveBeenCalledWith({
      where: {
        authUserId_legacyKey: {
          authUserId: 42,
          legacyKey: "import:v2:user:7:prompt:11",
        },
      },
      select: { id: true },
    });
    expect(promptCreate).toHaveBeenCalledWith({
      data: {
        authUserId: 42,
        name: "从内置编辑",
        category: "写作",
        content: "正文",
        revision: 4,
        legacyKey: "import:v2:user:7:prompt:11",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
      },
    });
    expect(deletionUpsert).toHaveBeenCalledWith({
      where: {
        authUserId_builtinPromptPresetId: {
          authUserId: 42,
          builtinPromptPresetId: BigInt(501),
        },
      },
      create: { authUserId: 42, builtinPromptPresetId: BigInt(501) },
      update: {},
    });
    expect(warnings).toEqual([
      "目标服务器缺少内置提示词 key：missing:key，已跳过",
    ]);
    expect(result).toEqual({
      customPrompts: 1,
      customPromptsSkipped: 0,
      deletedBuiltins: 1,
      warnings: 1,
    });
  });

  it("restores the same source archive idempotently per target without overwriting later edits", async () => {
    const importRunner = await import("@/lib/admin/user-import-runner") as any;
    expect(typeof importRunner.restorePromptPresetArchiveV2).toBe("function");
    if (typeof importRunner.restorePromptPresetArchiveV2 !== "function") return;

    const rows = new Map<string, { id: bigint }>();
    const promptFindUnique = vi.fn(async ({ where }: any) => {
      const value = where.authUserId_legacyKey;
      return rows.get(`${value.authUserId}:${value.legacyKey}`) ?? null;
    });
    const promptCreate = vi.fn(async ({ data }: any) => {
      const id = BigInt(rows.size + 1);
      rows.set(`${data.authUserId}:${data.legacyKey}`, { id });
      return { ...data, id };
    });
    const promptUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn(async () => []),
      promptPreset: {
        findUnique: promptFindUnique,
        create: promptCreate,
        update: promptUpdate,
      },
      builtinPromptPreset: { findMany: vi.fn(async () => []) },
      userBuiltinPromptDeletion: { upsert: vi.fn() },
      promptPresetMigrationState: { upsert: vi.fn() },
    };
    const archive = {
      version: 2,
      customPrompts: [{
        id: "11",
        name: "Imported once",
        category: "writing",
        content: "Body",
        revision: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      }],
      deletedBuiltinKeys: [],
    };

    const first = await importRunner.restorePromptPresetArchiveV2({
      tx,
      targetAuthUserId: 42,
      sourceArchiveUserId: 7,
      archive,
      warnings: [],
    });
    const duplicate = await importRunner.restorePromptPresetArchiveV2({
      tx,
      targetAuthUserId: 42,
      sourceArchiveUserId: 7,
      archive,
      warnings: [],
    });
    const otherTarget = await importRunner.restorePromptPresetArchiveV2({
      tx,
      targetAuthUserId: 43,
      sourceArchiveUserId: 7,
      archive,
      warnings: [],
    });

    expect(first).toMatchObject({ customPrompts: 1, customPromptsSkipped: 0 });
    expect(duplicate).toMatchObject({ customPrompts: 0, customPromptsSkipped: 1 });
    expect(otherTarget).toMatchObject({ customPrompts: 1, customPromptsSkipped: 0 });
    expect(promptCreate).toHaveBeenCalledTimes(2);
    expect(promptUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-version-2 prompt archives before writing", async () => {
    const importRunner = await import("@/lib/admin/user-import-runner") as any;
    expect(typeof importRunner.restorePromptPresetArchiveV2).toBe("function");
    if (typeof importRunner.restorePromptPresetArchiveV2 !== "function") return;

    const tx = {
      $queryRaw: vi.fn(),
      promptPreset: { create: vi.fn() },
      builtinPromptPreset: { findMany: vi.fn() },
      userBuiltinPromptDeletion: { upsert: vi.fn() },
    };
    await expect(importRunner.restorePromptPresetArchiveV2({
      tx,
      targetAuthUserId: 42,
      sourceArchiveUserId: 7,
      archive: { version: 1, customPrompts: [], deletedBuiltinKeys: [] },
      warnings: [],
    })).rejects.toThrow(/version 2/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.promptPreset.create).not.toHaveBeenCalled();
  });

  it.each([
    "0",
    "01",
    "-1",
    "1.0",
    " 1",
    "1 ",
    "9223372036854775808",
    1,
    {},
  ])("rejects malformed archived custom id %j before writing", async (id) => {
    const importRunner = await import("@/lib/admin/user-import-runner") as any;
    const tx = {
      $queryRaw: vi.fn(),
      promptPreset: { findUnique: vi.fn(), create: vi.fn() },
      builtinPromptPreset: { findMany: vi.fn() },
      userBuiltinPromptDeletion: { upsert: vi.fn() },
    };

    await expect(importRunner.restorePromptPresetArchiveV2({
      tx,
      targetAuthUserId: 42,
      sourceArchiveUserId: 7,
      archive: {
        version: 2,
        customPrompts: [{
          id,
          name: "Prompt",
          category: "writing",
          content: "Body",
          revision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
        }],
        deletedBuiltinKeys: [],
      },
      warnings: [],
    })).rejects.toThrow(/id/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.promptPreset.create).not.toHaveBeenCalled();
  });

  it.each([
    {},
    "",
    " ",
    "x".repeat(257),
    "bad\nkey",
  ])("rejects malformed deleted builtin key %j before writing", async (key) => {
    const importRunner = await import("@/lib/admin/user-import-runner") as any;
    const tx = {
      $queryRaw: vi.fn(),
      promptPreset: { findUnique: vi.fn(), create: vi.fn() },
      builtinPromptPreset: { findMany: vi.fn() },
      userBuiltinPromptDeletion: { upsert: vi.fn() },
    };

    await expect(importRunner.restorePromptPresetArchiveV2({
      tx,
      targetAuthUserId: 42,
      sourceArchiveUserId: 7,
      archive: {
        version: 2,
        customPrompts: [],
        deletedBuiltinKeys: [key],
      },
      warnings: [],
    })).rejects.toThrow(/deletedBuiltinKeys/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("requires declared v2 prompt data and validates both manifest row counts", async () => {
    const importRunner = await import("@/lib/admin/user-import-runner") as any;
    expect(typeof importRunner.parsePromptPresetArchiveForImport).toBe("function");
    if (typeof importRunner.parsePromptPresetArchiveForImport !== "function") return;

    const declaredManifest = {
      version: 1,
      promptPresetsVersion: 2,
      stats: {
        promptCustomPrompts: 1,
        promptDeletedBuiltinKeys: 1,
      },
    };
    await expect(importRunner.parsePromptPresetArchiveForImport(
      declaredManifest,
      undefined,
    )).rejects.toThrow(/data\/prompt_presets\.json/);

    const archive = {
      version: 2,
      customPrompts: [{
        id: "11",
        name: "Prompt",
        category: "writing",
        content: "Body",
        revision: 1,
        createdAt: null,
        updatedAt: null,
        deletedAt: null,
      }],
      deletedBuiltinKeys: ["canvas:portrait-v1"],
    };
    await expect(importRunner.parsePromptPresetArchiveForImport(
      { ...declaredManifest, stats: { ...declaredManifest.stats, promptCustomPrompts: 2 } },
      JSON.stringify(archive),
    )).rejects.toThrow(/prompt.*custom/i);
    await expect(importRunner.parsePromptPresetArchiveForImport(
      {
        ...declaredManifest,
        stats: { ...declaredManifest.stats, promptDeletedBuiltinKeys: 2 },
      },
      JSON.stringify(archive),
    )).rejects.toThrow(/prompt.*deleted/i);

    await expect(importRunner.parsePromptPresetArchiveForImport(
      { version: 1, stats: {} },
      undefined,
    )).resolves.toBeNull();
    await expect(importRunner.parsePromptPresetArchiveForImport(
      declaredManifest,
      JSON.stringify(archive),
    )).resolves.toEqual(archive);
  });

  it("deletes prompt lifecycle rows under one lock before the existing account deletion order", async () => {
    const userDelete = await import("@/lib/admin-user-delete") as any;
    const calls: string[] = [];
    const remove = (name: string, count = 1) => vi.fn(async () => {
      calls.push(name);
      return { count };
    });
    const client = {
      $queryRaw: vi.fn(async () => {
        calls.push("lock");
        return [];
      }),
      userBuiltinPromptDeletion: { deleteMany: remove("builtinDeletion") },
      promptPresetMigrationState: {
        deleteMany: remove("migrationState"),
        upsert: vi.fn(),
      },
      promptPreset: { deleteMany: remove("promptPreset") },
      userRoleSkill: {
        findMany: vi.fn(async () => {
          calls.push("userRoleSkillFind");
          return [];
        }),
        deleteMany: remove("userRoleSkill"),
      },
      canvas: { deleteMany: remove("canvas") },
      canvasProject: { deleteMany: remove("canvasProject") },
      canvasMutation: { deleteMany: remove("canvasMutation") },
      canvasMember: { deleteMany: remove("canvasMember") },
      imageBatch: { deleteMany: remove("imageBatch") },
      toolWorkspaceDraft: { deleteMany: remove("toolWorkspaceDraft") },
      mediaAsset: { deleteMany: remove("mediaAsset") },
      user: { deleteMany: remove("user") },
    };

    const result = await userDelete.deleteAdminUserCanvasAndAccount(client, 7);

    expect(calls).toEqual([
      "lock",
      "builtinDeletion",
      "migrationState",
      "promptPreset",
      "userRoleSkillFind",
      "userRoleSkill",
      "canvas",
      "canvasProject",
      "canvasMutation",
      "canvasMember",
      "imageBatch",
      "toolWorkspaceDraft",
      "mediaAsset",
      "user",
    ]);
    expect(result).toMatchObject({
      deletedBuiltinPromptDeletions: 1,
      deletedPromptPresetMigrationStates: 1,
      deletedPromptPresets: 1,
      deletedUsers: 1,
    });
  });

  it("writes a zero-row migration marker while resetting prompt data", async () => {
    const userDelete = await import("@/lib/admin-user-delete") as any;
    expect(typeof userDelete.resetAdminUserPromptPresetData).toBe("function");
    if (typeof userDelete.resetAdminUserPromptPresetData !== "function") return;

    const calls: string[] = [];
    const upsert = vi.fn(async () => {
      calls.push("marker");
      return {};
    });
    const client = {
      $queryRaw: vi.fn(async () => {
        calls.push("lock");
        return [];
      }),
      userBuiltinPromptDeletion: {
        deleteMany: vi.fn(async () => {
          calls.push("builtinDeletion");
          return { count: 2 };
        }),
      },
      promptPresetMigrationState: {
        deleteMany: vi.fn(async () => {
          calls.push("migrationState");
          return { count: 1 };
        }),
        upsert,
      },
      promptPreset: {
        deleteMany: vi.fn(async () => {
          calls.push("promptPreset");
          return { count: 3 };
        }),
      },
    };

    await userDelete.resetAdminUserPromptPresetData(client, {
      authUserId: 7,
      marker: {
        version: 1,
        digest: "legacy-digest",
      },
    });

    expect(calls).toEqual([
      "lock",
      "builtinDeletion",
      "migrationState",
      "promptPreset",
      "marker",
    ]);
    expect(upsert).toHaveBeenCalledWith({
      where: { subjectKey: "user:7:user-json" },
      create: expect.objectContaining({
        subjectKey: "user:7:user-json",
        authUserId: 7,
        source: "user-json",
        version: 1,
        digest: "legacy-digest",
        rowCount: 0,
      }),
      update: expect.objectContaining({
        authUserId: 7,
        source: "user-json",
        version: 1,
        digest: "legacy-digest",
        rowCount: 0,
      }),
    });
  });

  it("wires the v2 file, Task 3 legacy scan, transactions, and adminKey identities into production paths", () => {
    const exporter = read("lib/admin/user-export-builder.ts");
    const importer = read("lib/admin/user-import-runner.ts");
    const accountDelete = read("app/api/admin/user/delete/route.ts");
    const purge = read("app/api/admin/user/purge-data/route.ts");

    expect(exporter).toContain("data/prompt_presets.json");
    expect(exporter).toContain("buildPromptPresetArchiveV2");
    expect(importer).toContain("data/prompt_presets.json");
    expect(importer).toContain("restorePromptPresetArchiveV2");
    expect(importer).toContain("scanLegacyPromptPresets");
    expect(importer).not.toContain("function normalizeLegacyPrompt");
    expect(importer.indexOf("restorePromptPresetArchiveV2")).toBeLessThan(
      importer.lastIndexOf("prisma.$transaction"),
    );
    expect(accountDelete).toContain("parseAdminWorksAdminKey");
    expect(accountDelete).toContain("deleteAdminUserCanvasAndAccount(tx");
    expect(purge).toContain("parseAdminWorksAdminKey");
    expect(purge).toContain("resetAdminUserPromptPresetData(tx");
    expect(purge).toContain("scanLegacyPromptPresets");
    expect(purge).toContain("prisma.$transaction");
  });
});
