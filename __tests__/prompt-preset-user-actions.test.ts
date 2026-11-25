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
    failCreate: false,
    failDeletionUpsert: false,
    rowLockTails: new Map<bigint, Promise<void>>(),
  };

  const acquireRowLock = async (id: bigint): Promise<() => void> => {
    const previous = state.rowLockTails.get(id) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    state.rowLockTails.set(id, tail);
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (state.rowLockTails.get(id) === tail) state.rowLockTails.delete(id);
    };
  };

  const matchesPrompt = (row: PromptRow, where: {
    id?: bigint;
    authUserId?: number;
    deletedAt?: Date | null;
    revision?: number;
  }) => (
    (where.id === undefined || row.id === where.id)
    && (where.authUserId === undefined || row.authUserId === where.authUserId)
    && (where.deletedAt === undefined || row.deletedAt === where.deletedAt)
    && (where.revision === undefined || row.revision === where.revision)
  );

  const transactionClient = {
    promptPreset: {
      findMany: async ({ where }: {
        where: { authUserId: number; deletedAt: null };
      }) => state.prompts.filter((row) => matchesPrompt(row, where)),
      findFirst: async ({ where }: {
        where: { id?: bigint; authUserId?: number; deletedAt?: null; revision?: number };
      }) => state.prompts.find((row) => matchesPrompt(row, where)) ?? null,
      create: async ({ data }: {
        data: Pick<PromptRow, "authUserId" | "name" | "category" | "content">;
      }) => {
        if (state.failCreate) throw new Error("injected custom create failure");
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
      updateManyAndReturn: async ({ where, data }: {
        where: { id?: bigint; authUserId?: number; deletedAt?: null; revision?: number };
        data: Omit<Partial<PromptRow>, "revision"> & {
          revision?: number | { increment: number };
        };
      }) => {
        const updated: PromptRow[] = [];
        for (const row of state.prompts) {
          if (!matchesPrompt(row, where)) continue;
          const { revision, ...values } = data;
          Object.assign(row, values);
          if (typeof revision === "object") row.revision += revision.increment;
          else if (typeof revision === "number") row.revision = revision;
          row.updatedAt = new Date(state.now);
          updated.push(row);
        }
        return updated;
      },
    },
    builtinPromptPreset: {
      findFirst: async ({ where }: {
        where: { id: bigint; deletedAt: null };
      }) => state.builtins.find(
        (row) => row.id === where.id && row.deletedAt === where.deletedAt,
      ) ?? null,
      findMany: async ({ where }: {
        where: { deletedAt: null; deletions?: { none: { authUserId: number } } };
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
    userBuiltinPromptDeletion: {
      upsert: async ({ create }: {
        create: { authUserId: number; builtinPromptPresetId: bigint };
      }) => {
        if (state.failDeletionUpsert) throw new Error("injected deletion upsert failure");
        const existing = state.deletions.find(
          (row) => (
            row.authUserId === create.authUserId
            && row.builtinPromptPresetId === create.builtinPromptPresetId
          ),
        );
        if (existing) return existing;
        const row = { ...create, createdAt: new Date(state.now) };
        state.deletions.push(row);
        return row;
      },
    },
  };

  type LockedTransactionClient = typeof transactionClient & {
    $queryRaw: <T = unknown>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<T>;
  };

  const client = {
    ...transactionClient,
    $transaction: async <T>(
      work: (transaction: LockedTransactionClient) => Promise<T>,
    ): Promise<T> => {
      const snapshot = {
        promptIds: new Set(state.prompts.map(({ id }) => id)),
        deletionKeys: new Set(state.deletions.map(
          ({ authUserId, builtinPromptPresetId }) => `${authUserId}:${builtinPromptPresetId}`,
        )),
        nextPromptId: state.nextPromptId,
      };
      const releases: Array<() => void> = [];
      const tx: LockedTransactionClient = {
        ...transactionClient,
        $queryRaw: async <R = unknown>(
          strings: TemplateStringsArray,
          ...values: unknown[]
        ): Promise<R> => {
          if (!/\bFOR\s+UPDATE\b/i.test(strings.join(" "))) return [] as R;
          const [id] = values;
          if (typeof id !== "bigint") throw new Error("row lock requires a bigint id");
          releases.push(await acquireRowLock(id));
          return [{ id }] as R;
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        state.prompts.splice(
          0,
          state.prompts.length,
          ...state.prompts.filter(({ id }) => snapshot.promptIds.has(id)),
        );
        state.deletions.splice(
          0,
          state.deletions.length,
          ...state.deletions.filter(
            ({ authUserId, builtinPromptPresetId }) => snapshot.deletionKeys.has(
              `${authUserId}:${builtinPromptPresetId}`,
            ),
          ),
        );
        state.nextPromptId = snapshot.nextPromptId;
        throw error;
      } finally {
        releases.reverse().forEach((release) => release());
      }
    },
  };

  const adminUpdateBuiltin = async (input: {
    id: bigint;
    changes: Partial<Pick<BuiltinRow, "name" | "revision" | "deletedAt">>;
    commitSignal: Promise<void>;
    whenLocked: () => void;
  }): Promise<void> => {
    const release = await acquireRowLock(input.id);
    try {
      input.whenLocked();
      await input.commitSignal;
      const row = state.builtins.find(({ id }) => id === input.id);
      if (row) {
        Object.assign(row, input.changes);
        row.updatedAt = new Date(state.now);
      }
    } finally {
      release();
    }
  };

  return { adminUpdateBuiltin, client, state };
});

vi.mock("@/lib/prisma", () => ({ default: fake.client }));

import {
  PromptPresetRepositoryError,
  deletePromptForUser,
  listEffectivePromptPresets,
  updatePromptForUser,
} from "@/lib/prompt-presets/repository";

const at = (iso: string) => new Date(iso);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settlesBeforeNextTurn(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise<false>((resolve) => setImmediate(() => resolve(false))),
  ]);
}

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

describe("per-user prompt actions", () => {
  beforeEach(() => {
    fake.state.prompts.length = 0;
    fake.state.builtins.length = 0;
    fake.state.deletions.length = 0;
    fake.state.nextPromptId = BigInt(100);
    fake.state.now = at("2026-07-30T08:00:00.000Z");
    fake.state.failCreate = false;
    fake.state.failDeletionUpsert = false;
    fake.state.rowLockTails.clear();
  });

  it("updates only an owned active custom at the expected revision", async () => {
    fake.state.prompts.push(custom({ id: BigInt(10), authUserId: 1, revision: 4 }));

    const result = await updatePromptForUser({
      authUserId: 1,
      publicId: "custom:10",
      expectedRevision: 4,
      value: { name: "  新名称  ", category: "  新分类  ", content: "  新内容  " },
    });

    expect(result).toEqual(expect.objectContaining({
      id: "custom:10",
      name: "新名称",
      category: "新分类",
      content: "新内容",
      source: "custom",
      revision: 5,
    }));
    expect(fake.state.prompts[0]).toEqual(expect.objectContaining({
      name: "新名称",
      revision: 5,
      deletedAt: null,
    }));
  });

  it("rejects stale, foreign, and deleted custom updates with typed errors", async () => {
    fake.state.prompts.push(
      custom({ id: BigInt(10), authUserId: 1, revision: 4 }),
      custom({ id: BigInt(11), authUserId: 2 }),
      custom({ id: BigInt(12), authUserId: 1, deletedAt: at("2026-07-30T07:00:00.000Z") }),
    );
    const value = { name: "新名称", category: "新分类", content: "新内容" };

    await expect(updatePromptForUser({
      authUserId: 1,
      publicId: "custom:10",
      expectedRevision: 3,
      value,
    })).rejects.toMatchObject({ code: "conflict" } satisfies Partial<PromptPresetRepositoryError>);
    await expect(updatePromptForUser({
      authUserId: 1,
      publicId: "custom:11",
      expectedRevision: 1,
      value,
    })).rejects.toMatchObject({ code: "not-found" } satisfies Partial<PromptPresetRepositoryError>);
    await expect(updatePromptForUser({
      authUserId: 1,
      publicId: "custom:12",
      expectedRevision: 1,
      value,
    })).rejects.toMatchObject({ code: "not-found" } satisfies Partial<PromptPresetRepositoryError>);
    expect(fake.state.prompts.map(({ revision }) => revision)).toEqual([4, 1, 1]);
  });

  it("converts a builtin in one transaction into an unrelated normalized custom and hides it only for that user", async () => {
    fake.state.builtins.push(builtin({ id: BigInt(1), key: "builtin-key", revision: 3 }));

    const result = await updatePromptForUser({
      authUserId: 1,
      publicId: "builtin:1",
      expectedRevision: 3,
      value: { name: "  我的版本  ", category: "  我的分类  ", content: "  我的内容  " },
    });

    const persisted = fake.state.prompts[0];
    expect(result).toEqual(expect.objectContaining({
      id: "custom:100",
      source: "custom",
      name: "我的版本",
      category: "我的分类",
      content: "我的内容",
    }));
    expect(persisted).toEqual(expect.objectContaining({
      authUserId: 1,
      name: "我的版本",
      category: "我的分类",
      content: "我的内容",
      legacyKey: null,
    }));
    expect(Object.keys(persisted)).not.toEqual(expect.arrayContaining([
      "originBuiltinId",
      "builtinPromptPresetId",
      "key",
    ]));
    expect(fake.state.deletions).toEqual([
      expect.objectContaining({ authUserId: 1, builtinPromptPresetId: BigInt(1) }),
    ]);
    expect((await listEffectivePromptPresets({ authUserId: 1 })).map(({ id }) => id))
      .toEqual(["custom:100"]);
    expect((await listEffectivePromptPresets({ authUserId: 2 })).map(({ id }) => id))
      .toEqual(["builtin:1"]);
  });

  it("rejects a stale or globally deleted builtin before conversion", async () => {
    fake.state.builtins.push(
      builtin({ id: BigInt(1), key: "active", revision: 3 }),
      builtin({ id: BigInt(2), key: "deleted", deletedAt: at("2026-07-30T07:00:00.000Z") }),
    );
    const value = { name: "我的版本", category: "我的分类", content: "我的内容" };

    await expect(updatePromptForUser({
      authUserId: 1,
      publicId: "builtin:1",
      expectedRevision: 2,
      value,
    })).rejects.toMatchObject({ code: "conflict" } satisfies Partial<PromptPresetRepositoryError>);
    await expect(updatePromptForUser({
      authUserId: 1,
      publicId: "builtin:2",
      expectedRevision: 1,
      value,
    })).rejects.toMatchObject({ code: "not-found" } satisfies Partial<PromptPresetRepositoryError>);
    expect(fake.state.prompts).toHaveLength(0);
    expect(fake.state.deletions).toHaveLength(0);
  });

  it("waits for an administrator row lock before validating a builtin edit revision", async () => {
    fake.state.builtins.push(builtin({ id: BigInt(1), key: "active", revision: 1 }));
    const adminLocked = deferred();
    const adminCommit = deferred();
    const adminUpdate = fake.adminUpdateBuiltin({
      id: BigInt(1),
      changes: { name: "管理员版本", revision: 2 },
      commitSignal: adminCommit.promise,
      whenLocked: adminLocked.resolve,
    });
    await adminLocked.promise;

    const userUpdate = updatePromptForUser({
      authUserId: 1,
      publicId: "builtin:1",
      expectedRevision: 1,
      value: { name: "用户版本", category: "用户分类", content: "用户内容" },
    });
    const settledWhileAdminHeldLock = await settlesBeforeNextTurn(userUpdate);

    adminCommit.resolve();
    await adminUpdate;

    expect(settledWhileAdminHeldLock).toBe(false);
    await expect(userUpdate).rejects.toMatchObject(
      { code: "conflict" } satisfies Partial<PromptPresetRepositoryError>,
    );
    expect(fake.state.builtins[0]).toEqual(expect.objectContaining({
      name: "管理员版本",
      revision: 2,
    }));
    expect(fake.state.prompts).toHaveLength(0);
    expect(fake.state.deletions).toHaveLength(0);
  });

  it.each([
    ["custom creation", "failCreate"],
    ["builtin deletion upsert", "failDeletionUpsert"],
  ] as const)("rolls back both conversion writes when %s fails", async (_label, failure) => {
    fake.state.builtins.push(builtin({ id: BigInt(1), key: "active" }));
    fake.state[failure] = true;

    await expect(updatePromptForUser({
      authUserId: 1,
      publicId: "builtin:1",
      expectedRevision: 1,
      value: { name: "我的版本", category: "我的分类", content: "我的内容" },
    })).rejects.toThrow(/injected/);
    expect(fake.state.prompts).toHaveLength(0);
    expect(fake.state.deletions).toHaveLength(0);
  });

  it("keeps a detached custom unchanged after its former builtin is globally deleted", async () => {
    fake.state.builtins.push(builtin({ id: BigInt(1), key: "active" }));
    const detached = await updatePromptForUser({
      authUserId: 1,
      publicId: "builtin:1",
      expectedRevision: 1,
      value: { name: "我的版本", category: "我的分类", content: "我的内容" },
    });

    fake.state.builtins[0].name = "管理员新名称";
    fake.state.builtins[0].deletedAt = at("2026-07-30T09:00:00.000Z");

    expect(await listEffectivePromptPresets({ authUserId: 1 })).toEqual([
      expect.objectContaining({
        id: detached.id,
        name: "我的版本",
        content: "我的内容",
        source: "custom",
      }),
    ]);
  });

  it("soft-deletes only an owned custom at the expected revision without restoring a detached builtin", async () => {
    fake.state.prompts.push(
      custom({ id: BigInt(10), authUserId: 1, revision: 2 }),
      custom({ id: BigInt(11), authUserId: 2, revision: 2 }),
    );
    fake.state.builtins.push(builtin({ id: BigInt(1), key: "former-builtin" }));
    fake.state.deletions.push({
      authUserId: 1,
      builtinPromptPresetId: BigInt(1),
      createdAt: at("2026-07-30T07:00:00.000Z"),
    });

    await deletePromptForUser({
      authUserId: 1,
      publicId: "custom:10",
      expectedRevision: 2,
    });

    expect(fake.state.prompts[0]).toEqual(expect.objectContaining({
      revision: 3,
      deletedAt: expect.any(Date),
    }));
    expect(fake.state.prompts[1].deletedAt).toBeNull();
    expect(fake.state.deletions).toHaveLength(1);
    expect(await listEffectivePromptPresets({ authUserId: 1 })).toEqual([]);
    expect((await listEffectivePromptPresets({ authUserId: 2 })).map(({ id }) => id))
      .toEqual(["builtin:1", "custom:11"]);
  });

  it("requires expectedRevision and rejects stale or foreign custom deletes", async () => {
    fake.state.prompts.push(
      custom({ id: BigInt(10), authUserId: 1, revision: 2 }),
      custom({ id: BigInt(11), authUserId: 2, revision: 2 }),
    );

    await expect(deletePromptForUser({
      authUserId: 1,
      publicId: "custom:10",
    })).rejects.toMatchObject({ code: "invalid" } satisfies Partial<PromptPresetRepositoryError>);
    await expect(deletePromptForUser({
      authUserId: 1,
      publicId: "custom:10",
      expectedRevision: 1,
    })).rejects.toMatchObject({ code: "conflict" } satisfies Partial<PromptPresetRepositoryError>);
    await expect(deletePromptForUser({
      authUserId: 1,
      publicId: "custom:11",
      expectedRevision: 2,
    })).rejects.toMatchObject({ code: "not-found" } satisfies Partial<PromptPresetRepositoryError>);
    expect(fake.state.prompts.every(({ deletedAt }) => deletedAt === null)).toBe(true);
  });

  it("idempotently hides an active builtin for one user without affecting another", async () => {
    fake.state.builtins.push(builtin({ id: BigInt(1), key: "active" }));

    await deletePromptForUser({ authUserId: 1, publicId: "builtin:1" });
    await deletePromptForUser({ authUserId: 1, publicId: "builtin:1" });

    expect(fake.state.deletions).toEqual([
      expect.objectContaining({ authUserId: 1, builtinPromptPresetId: BigInt(1) }),
    ]);
    expect(await listEffectivePromptPresets({ authUserId: 1 })).toEqual([]);
    expect((await listEffectivePromptPresets({ authUserId: 2 })).map(({ id }) => id))
      .toEqual(["builtin:1"]);
  });

  it("waits for an administrator row lock before deleting a builtin with expectedRevision", async () => {
    fake.state.builtins.push(builtin({ id: BigInt(1), key: "active", revision: 1 }));
    const adminLocked = deferred();
    const adminCommit = deferred();
    const adminDelete = fake.adminUpdateBuiltin({
      id: BigInt(1),
      changes: {
        revision: 2,
        deletedAt: at("2026-07-30T09:00:00.000Z"),
      },
      commitSignal: adminCommit.promise,
      whenLocked: adminLocked.resolve,
    });
    await adminLocked.promise;

    const userDelete = deletePromptForUser({
      authUserId: 1,
      publicId: "builtin:1",
      expectedRevision: 1,
    });
    const settledWhileAdminHeldLock = await settlesBeforeNextTurn(userDelete);

    adminCommit.resolve();
    await adminDelete;

    expect(settledWhileAdminHeldLock).toBe(false);
    await expect(userDelete).rejects.toMatchObject(
      { code: "not-found" } satisfies Partial<PromptPresetRepositoryError>,
    );
    expect(fake.state.deletions).toHaveLength(0);
  });
});
