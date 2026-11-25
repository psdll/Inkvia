import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  return {
    callOrder,
    generationFindMany: vi.fn(),
    generationDeleteMany: vi.fn(async () => {
      callOrder.push("database");
      return { count: 1 };
    }),
    imageBatchOutputDeleteMany: vi.fn(async () => {
      callOrder.push("batch-output");
      return { count: 1 };
    }),
    imageBatchMediaFindMany: vi.fn(async () => []),
    toolWorkspaceDraftMediaFindMany: vi.fn(async () => []),
    promptLock: vi.fn(async () => {
      callOrder.push("prompt-lock");
      return [];
    }),
    builtinDeletionDeleteMany: vi.fn(async () => {
      callOrder.push("prompt-builtin-delete");
      return { count: 2 };
    }),
    migrationStateDeleteMany: vi.fn(async () => {
      callOrder.push("prompt-state-delete");
      return { count: 1 };
    }),
    promptPresetDeleteMany: vi.fn(async () => {
      callOrder.push("prompt-delete");
      return { count: 3 };
    }),
    userRoleSkillFindMany: vi.fn(async () => {
      callOrder.push("skill-find");
      return [{ coverUrl: "/uploads/role_skill_covers/users/7/cover.webp" }];
    }),
    userRoleSkillDeleteMany: vi.fn(async () => {
      callOrder.push("skill-delete");
      return { count: 1 };
    }),
    migrationStateUpsert: vi.fn(async () => {
      callOrder.push("prompt-marker");
      return {};
    }),
    logFindMany: vi.fn<
      () => Promise<Array<{ metadata: string | null }>>
    >(async () => []),
    logDeleteMany: vi.fn(async () => ({ count: 0 })),
    logCreate: vi.fn(async () => ({})),
    userFindUnique: vi.fn(async () => ({ username: "tester" })),
    usageLedgerDeleteMany: vi.fn(async () => ({ count: 0 })),
    workFeedUpdateMany: vi.fn(async () => ({ count: 1 })),
    collectComparableMediaRefsByGenerationWhere: vi.fn(async () => new Set<string>()),
    deleteStoredMediaRefs: vi.fn(async (refs: unknown[]) => {
      callOrder.push(String(refs[0] || "").includes("role_skill_covers") ? "skill-storage" : "storage");
      return {
        deletedOssObjects: 1,
        deletedLocalFiles: 0,
        deletedOssKeys: ["uploads/generated/a.png"],
        failedOssKeys: [],
        ossError: "",
      };
    }),
    invalidateAdminUserSummariesCache: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/admin-user-scope", () => ({
  resolveAdminUserScope: vi.fn(async () => ({
    requestedUserId: "7",
    authUserId: 7,
    linkedUserIds: ["device-a"],
    presetUserIds: ["7"],
    generationWhere: { authUserId: 7 },
    logWhere: { userId: "device-a" },
  })),
  invalidateAdminUserSummariesCache: mocks.invalidateAdminUserSummariesCache,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(async (callback: (tx: any) => Promise<any>) =>
      callback({
        $queryRaw: mocks.promptLock,
        userBuiltinPromptDeletion: {
          deleteMany: mocks.builtinDeletionDeleteMany,
        },
        promptPresetMigrationState: {
          deleteMany: mocks.migrationStateDeleteMany,
          upsert: mocks.migrationStateUpsert,
        },
        promptPreset: { deleteMany: mocks.promptPresetDeleteMany },
        userRoleSkill: {
          findMany: mocks.userRoleSkillFindMany,
          deleteMany: mocks.userRoleSkillDeleteMany,
        },
        usageLedger: { deleteMany: mocks.usageLedgerDeleteMany },
        log: { deleteMany: mocks.logDeleteMany },
        imageBatchOutput: {
          findMany: vi.fn(async () => [{ itemId: "image-item", item: { groupId: "image-group" } }]),
          deleteMany: mocks.imageBatchOutputDeleteMany,
        },
        imageBatchItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        imageBatchGroup: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        liveVideoBatchOutput: {
          findMany: vi.fn(async () => []),
          deleteMany: vi.fn(async () => ({ count: 0 })),
        },
        liveVideoBatchItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        liveVideoBatch: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        generation: { deleteMany: mocks.generationDeleteMany },
      })
    ),
    generation: {
      findMany: mocks.generationFindMany,
      deleteMany: mocks.generationDeleteMany,
    },
    imageBatchOutput: { deleteMany: mocks.imageBatchOutputDeleteMany },
    imageBatchMedia: { findMany: mocks.imageBatchMediaFindMany },
    toolWorkspaceDraftMedia: { findMany: mocks.toolWorkspaceDraftMediaFindMany },
    log: {
      findMany: mocks.logFindMany,
      deleteMany: mocks.logDeleteMany,
      create: mocks.logCreate,
    },
    user: { findUnique: mocks.userFindUnique },
    usageLedger: { deleteMany: mocks.usageLedgerDeleteMany },
    adminWorkFeed: { updateMany: mocks.workFeedUpdateMany },
  },
}));

vi.mock("@/lib/prompt-presets/migration", () => ({
  scanLegacyPromptPresets: vi.fn(async () => ({
    version: 1,
    digest: "legacy-digest",
    validCount: 2,
  })),
}));

vi.mock("@/lib/media-cleanup", () => ({
  collectMediaRefs: (value: unknown, out: Set<string>) => {
    if (typeof value === "string" && value.trim()) {
      out.add(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.add(item.trim());
        else if (item && typeof item === "object") {
          for (const nested of Object.values(item)) {
            if (typeof nested === "string" && nested.trim()) out.add(nested.trim());
          }
        }
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) {
        if (typeof nested === "string" && nested.trim()) out.add(nested.trim());
      }
    }
  },
  normalizeComparableMediaRef: (value: unknown) => String(value || "").trim(),
  collectComparableMediaRefsByGenerationWhere: mocks.collectComparableMediaRefsByGenerationWhere,
  deleteStoredMediaRefs: mocks.deleteStoredMediaRefs,
}));

vi.mock("@/lib/admin-asset-feed", () => ({
  markAdminAssetFeedDeleted: vi.fn(async () => 1),
}));

vi.mock("@/lib/admin-operational", () => ({
  enqueueAdminEvent: vi.fn(async () => undefined),
  writeAdminAuditLog: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/admin/user/purge-data/route";

const originalAdminPassword = process.env.ADMIN_PASSWORD;

describe("admin user generation purge ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    process.env.ADMIN_PASSWORD = "test-password";
    mocks.generationFindMany.mockResolvedValue([
      {
        id: 201,
        localPath: "/uploads/generated/a.png",
        templateData: null,
      },
    ]);
  });

  afterEach(() => {
    if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  it("protects cross-user references globally and deletes storage only after database rows", async () => {
    const request = new NextRequest("http://localhost/api/admin/user/purge-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "7",
        authUserId: 7,
        adminPassword: "test-password",
        purgeGenerations: true,
        purgeLogs: false,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.collectComparableMediaRefsByGenerationWhere).toHaveBeenCalledWith({
      id: { notIn: [201] },
    });
    expect(mocks.deleteStoredMediaRefs).toHaveBeenCalledWith(
      ["/uploads/generated/a.png"],
      expect.objectContaining({ protectedGenerationComparableRefs: expect.any(Set) }),
    );
    expect(mocks.imageBatchOutputDeleteMany).toHaveBeenCalledWith({
      where: { itemId: { in: expect.any(Array) } },
    });
    expect(mocks.callOrder).toEqual([
      "batch-output",
      "database",
      "storage",
      "prompt-lock",
      "prompt-builtin-delete",
      "prompt-state-delete",
      "prompt-delete",
      "prompt-marker",
      "skill-find",
      "skill-delete",
      "skill-storage",
    ]);
    expect(mocks.migrationStateUpsert).toHaveBeenCalledWith({
      where: { subjectKey: "user:7:user-json" },
      create: expect.objectContaining({ digest: "legacy-digest", rowCount: 0 }),
      update: expect.objectContaining({ digest: "legacy-digest", rowCount: 0 }),
    });
  });

  it("resolves the audio category to audio_gen for scoped cleanup", async () => {
    mocks.generationFindMany.mockResolvedValueOnce([]);
    const response = await POST(new NextRequest("http://localhost/api/admin/user/purge-data", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        userId: "7", authUserId: 7, purgeGenerations: true, generationStatus: "failed", generationTypes: ["audio"],
      }),
    }));
    expect(response.status).toBe(200);
    const where = mocks.generationFindMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"audio_gen"');
  });

  it("does not treat generation and log snapshots as owned files during purge", async () => {
    mocks.generationFindMany.mockResolvedValueOnce([
      {
        id: 201,
        localPath: "/uploads/generated/a.png",
        templateData: "/uploads/batch_imports/template-input.png",
      },
    ]);
    mocks.logFindMany.mockResolvedValueOnce([
      { metadata: "/uploads/batch_imports/log-input.png" },
    ]);
    const request = new NextRequest("http://localhost/api/admin/user/purge-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "7",
        authUserId: 7,
        adminPassword: "test-password",
        purgeGenerations: true,
        purgeLogs: false,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.deleteStoredMediaRefs).toHaveBeenCalledWith(
      ["/uploads/generated/a.png"],
      expect.anything(),
    );
  });

  it("keeps media files that are still referenced by an image batch draft", async () => {
    mocks.imageBatchMediaFindMany.mockResolvedValue([
      {
        media: {
          publicUrl: "/uploads/generated/a.png",
          originalKey: "uploads/generated/a.png",
        },
      },
    ] as any);
    const request = new NextRequest("http://localhost/api/admin/user/purge-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "7",
        authUserId: 7,
        adminPassword: "test-password",
        purgeGenerations: true,
        purgeLogs: false,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.generationDeleteMany).toHaveBeenCalled();
    expect(mocks.deleteStoredMediaRefs).not.toHaveBeenCalledWith(
      expect.arrayContaining(["/uploads/generated/a.png"]),
      expect.anything(),
    );
  });

  it("stops cleanup when persisted media references cannot be verified", async () => {
    mocks.imageBatchMediaFindMany.mockRejectedValueOnce(new Error("database unavailable"));
    const request = new NextRequest("http://localhost/api/admin/user/purge-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "7",
        authUserId: 7,
        adminPassword: "test-password",
        purgeGenerations: true,
        purgeLogs: false,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(mocks.generationDeleteMany).not.toHaveBeenCalled();
    expect(mocks.deleteStoredMediaRefs).not.toHaveBeenCalled();
  });

  it("does not delete personal Skills during the password-free failed-task cleanup", async () => {
    mocks.generationFindMany.mockResolvedValue([]);
    const request = new NextRequest("http://localhost/api/admin/user/purge-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "7",
        authUserId: 7,
        purgeGenerations: true,
        generationStatus: "failed",
        purgeLogs: false,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.userRoleSkillFindMany).not.toHaveBeenCalled();
    expect(mocks.userRoleSkillDeleteMany).not.toHaveBeenCalled();
  });
});
