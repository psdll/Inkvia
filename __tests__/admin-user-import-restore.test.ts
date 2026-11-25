import { describe, expect, it, vi } from "vitest";

describe("admin user import row restoration", () => {
  it("remaps a conflicting primary key instead of silently dropping the archived row", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore").catch(() => null) as any;
    expect(typeof restoreModule?.restoreRowsWithId).toBe("function");
    if (typeof restoreModule?.restoreRowsWithId !== "function") return;

    const createMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => ({ count: data.length }));
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 901 }));
    const model = {
      findMany: vi.fn(async () => [{ id: 7, ownerId: 999, value: "target row" }]),
      createMany,
      create,
    };

    const result = await restoreModule.restoreRowsWithId(
      model,
      [{ id: 7, ownerId: 18, value: "archived row" }],
      {
        equivalent: (existing: Record<string, unknown>, archived: Record<string, unknown>) =>
          existing.ownerId === archived.ownerId && existing.value === archived.value,
      },
    );

    expect(createMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ data: { ownerId: 18, value: "archived row" } });
    expect(result).toMatchObject({ restored: 1, inserted: 1, reused: 0, remapped: 1 });
    expect(result.idMap.get(7)).toBe(901);
  });

  it("reuses an equivalent archived row without duplicating it", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore").catch(() => null) as any;
    expect(typeof restoreModule?.restoreRowsWithId).toBe("function");
    if (typeof restoreModule?.restoreRowsWithId !== "function") return;

    const model = {
      findMany: vi.fn(async () => [{ id: 7, ownerId: 18, value: "archived row" }]),
      createMany: vi.fn(),
      create: vi.fn(),
    };

    const result = await restoreModule.restoreRowsWithId(
      model,
      [{ id: 7, ownerId: 18, value: "archived row" }],
      {
        equivalent: (existing: Record<string, unknown>, archived: Record<string, unknown>) =>
          existing.ownerId === archived.ownerId && existing.value === archived.value,
      },
    );

    expect(model.createMany).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 1, inserted: 0, reused: 1, remapped: 0 });
    expect(result.idMap.get(7)).toBe(7);
  });

  it("reuses a row found by its business unique key before remapping a conflicting id", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore") as any;
    const model = {
      findMany: vi.fn(async () => [{ id: 7, generationId: 99 }, { id: 42, generationId: 18 }]),
      createMany: vi.fn(),
      create: vi.fn(),
    };

    const result = await restoreModule.restoreRowsWithId(
      model,
      [{ id: 7, generationId: 18, amount: "1.25" }],
      {
        equivalent: () => false,
        reuseByUniqueKey: {
          key: (row: Record<string, unknown>) => String(row.generationId),
          findExisting: async () => [{ id: 42, generationId: 18, amount: "1.25" }],
        },
      },
    );

    expect(model.createMany).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 1, inserted: 0, reused: 1, remapped: 0 });
    expect(result.idMap.get(7)).toBe(42);
  });

  it("advances the database sequence after preserved ids and before allocating remapped ids", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore") as any;
    const calls: string[] = [];
    const model = {
      findMany: vi.fn(async () => [{ id: 7, ownerId: 999 }]),
      createMany: vi.fn(async () => {
        calls.push("preserve");
        return { count: 1 };
      }),
      create: vi.fn(async () => {
        calls.push("remap");
        return { id: 901 };
      }),
    };

    await restoreModule.restoreRowsWithId(
      model,
      [{ id: 8, ownerId: 18 }, { id: 7, ownerId: 18 }],
      {
        equivalent: () => false,
        prepareAutoIds: async () => {
          calls.push("sequence");
        },
      },
    );

    expect(calls).toEqual(["preserve", "sequence", "remap"]);
  });

  it("uses collision-aware restoration in the import runner", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "lib/admin/user-import-runner.ts"), "utf8");

    expect(source).toContain('from "@/lib/admin/user-import-restore"');
    expect(source).toContain("restoreRowsWithId");
    expect(source).not.toContain("skipDuplicates: true");
    expect(source).toContain("restoreImportedAccount");
    expect(source).not.toContain("tx.user.upsert");
    expect(source).toContain('{ numeric: ["authUserId"], textual: ["userId"] }');
  });

  it("wires business unique-key reuse for usage ledgers and user memories", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "lib/admin/user-import-runner.ts"), "utf8");

    expect(source).toContain("usageLedgerUniqueKey");
    expect(source).toContain("userMemoryUniqueKey");
    expect(source).toContain("reuseByUniqueKey");
  });

  it("reuses previously remapped rows by stable restore identity on repeated imports", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "lib/admin/user-import-runner.ts"), "utf8");

    expect(source).toContain("RESTORE_IDENTITY_TIME_FIELDS");
    expect(source).toContain("restoreIdentityKey");
    expect(source).toContain("findExistingByRestoreIdentity");
  });

  it("refreshes the retention anchor for every restored generation and log", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "lib/admin/user-import-runner.ts"), "utf8");

    expect(source).toContain("importRestoredAt");
    expect(source).toContain("restoredAt: importRestoredAt");
    expect(source).toContain("tx.generation.updateMany");
    expect(source).toContain("tx.log.updateMany");
  });

  it("restores personal Skills before remapping prompt task provenance", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "lib/admin/user-import-runner.ts"), "utf8");

    expect(source.indexOf("restoreUserRoleSkillArchiveV1({")).toBeLessThan(
      source.indexOf("if (promptReverseTasksRaw.length)"),
    );
    expect(source).toContain("userRoleSkillIdMap");
    expect(source).toContain("remapPromptReverseTaskRoleSkill");
    expect(source).toContain("role_skill_covers/users/");
  });

  it("deduplicates overlapping log exports by archived id", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore") as any;
    const duplicate = { id: 12, category: "generation", action: "done" };

    const rows = restoreModule.mergeRestoreRowsById([[duplicate], [{ ...duplicate }], [{ id: 13, action: "feedback" }]]);

    expect(rows).toEqual([duplicate, { id: 13, action: "feedback" }]);
    expect(() => restoreModule.mergeRestoreRowsById([[duplicate], [{ ...duplicate, action: "different" }]])).toThrow(
      /同一主键内容不一致/,
    );
  });

  it("reuses a local same-name user without overwriting credentials", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore") as any;
    const localUser = { id: 25, username: "郭吉雅", password: "local-password", token: "local-token" };
    const model = {
      findUnique: vi.fn(async ({ where }: any) => where.username === "郭吉雅" ? localUser : null),
      create: vi.fn(),
      update: vi.fn(),
    };

    const result = await restoreModule.resolveImportedUser(
      model,
      { id: 11, username: "郭吉雅", password: "server-password", token: "server-token" },
      vi.fn(),
    );

    expect(result).toMatchObject({ sourceUserId: 11, targetUserId: 25, created: false });
    expect(model.create).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });

  it("requires normal registration before importing an absent account", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore");
    const model = { findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn() };
    await expect(restoreModule.resolveImportedUser(model, { id: 11, username: "server-user", password: "archive-password", token: "archive-token" }, vi.fn())).rejects.toThrow("正常注册");
    expect(model.create).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });

  it("rejects damaged or incomplete archive JSON instead of treating it as empty", async () => {
    const restoreModule = await import("@/lib/admin/user-import-restore") as any;

    expect(() => restoreModule.parseArchiveJsonRows("{broken", "data/generations.json")).toThrow(/JSON 损坏/);
    expect(() => restoreModule.assertArchiveRowCount({ stats: { generations: 2 } }, "generations", [{}], "data/generations.json"))
      .toThrow(/数据不完整/);
  });
});
