import { execFile } from "node:child_process";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPromptPresetMigrationService,
  scanLegacyPromptPresets,
} from "@/lib/prompt-presets/migration";

type PromptRow = {
  authUserId: number;
  name: string;
  category: string;
  content: string;
  legacyKey: string;
  revision: number;
};

type BuiltinRow = {
  key: string;
  name: string;
  category: string;
  content: string;
};

type MigrationStateRow = {
  subjectKey: string;
  authUserId: number | null;
  source: string;
  version: number;
  digest: string;
  rowCount: number;
};

class FakePrisma {
  promptRows: PromptRow[] = [];
  builtinRows: BuiltinRow[] = [];
  migrationStateRows: MigrationStateRow[] = [];
  failMigrationStateWrite = false;
  failPromptUpsertAfterWrite = false;
  delayPromptReads = false;
  delayMigrationStateReads = false;
  private subjectLockTails = new Map<string, Promise<void>>();

  promptPreset = {
    createMany: async ({
      data,
    }: {
      data: Array<Omit<PromptRow, "revision">>;
      skipDuplicates: boolean;
    }) => {
      let count = 0;
      for (const row of data) {
        if (
          this.promptRows.some(
            (candidate) =>
              candidate.authUserId === row.authUserId &&
              candidate.legacyKey === row.legacyKey,
          )
        ) {
          continue;
        }
        this.promptRows.push({ ...row, revision: 1 });
        count += 1;
      }
      return { count };
    },
    findUnique: async ({
      where,
    }: {
      where: {
        authUserId_legacyKey: { authUserId: number; legacyKey: string };
      };
    }) => {
      const result = this.promptRows.find(
        (row) =>
          row.authUserId === where.authUserId_legacyKey.authUserId &&
          row.legacyKey === where.authUserId_legacyKey.legacyKey,
      ) ?? null;
      if (this.delayPromptReads) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return result;
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: {
        authUserId_legacyKey: { authUserId: number; legacyKey: string };
      };
      create: Omit<PromptRow, "revision">;
      update: Pick<PromptRow, "name" | "category" | "content"> & {
        revision: { increment: number };
      };
    }) => {
      const index = this.promptRows.findIndex(
        (row) =>
          row.authUserId === where.authUserId_legacyKey.authUserId &&
          row.legacyKey === where.authUserId_legacyKey.legacyKey,
      );
      if (index === -1) {
        this.promptRows.push({ ...create, revision: 1 });
      } else {
        this.promptRows[index] = {
          ...this.promptRows[index],
          name: update.name,
          category: update.category,
          content: update.content,
          revision:
            this.promptRows[index].revision + update.revision.increment,
        };
      }
      if (this.failPromptUpsertAfterWrite) {
        throw new Error("prompt upsert failed");
      }
      return index === -1
        ? this.promptRows[this.promptRows.length - 1]
        : this.promptRows[index];
    },
  };

  builtinPromptPreset = {
    createMany: async ({ data }: { data: BuiltinRow[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (this.builtinRows.some((candidate) => candidate.key === row.key)) {
          continue;
        }
        this.builtinRows.push({ ...row });
        count += 1;
      }
      return { count };
    },
  };

  promptPresetMigrationState = {
    findUnique: async ({ where }: { where: { subjectKey: string } }) => {
      const result =
        this.migrationStateRows.find((row) => row.subjectKey === where.subjectKey) ??
        null;
      if (this.delayMigrationStateReads) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return result;
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { subjectKey: string };
      create: MigrationStateRow;
      update: Omit<MigrationStateRow, "subjectKey">;
    }) => {
      if (this.failMigrationStateWrite) {
        throw new Error("state write failed");
      }
      const index = this.migrationStateRows.findIndex(
        (row) => row.subjectKey === where.subjectKey,
      );
      if (index === -1) {
        this.migrationStateRows.push({ ...create });
        return create;
      }
      this.migrationStateRows[index] = {
        ...this.migrationStateRows[index],
        ...update,
      };
      return this.migrationStateRows[index];
    },
  };

  private async acquireSubjectLock(subjectKey: string) {
    const previous = this.subjectLockTails.get(subjectKey) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.subjectLockTails.set(subjectKey, tail);
    await previous;
    return () => {
      releaseCurrent();
      if (this.subjectLockTails.get(subjectKey) === tail) {
        void tail.then(() => {
          if (this.subjectLockTails.get(subjectKey) === tail) {
            this.subjectLockTails.delete(subjectKey);
          }
        });
      }
    };
  }

  async $transaction<T>(operation: (tx: FakePrisma) => Promise<T>): Promise<T> {
    const snapshot = {
      promptRows: structuredClone(this.promptRows),
      builtinRows: structuredClone(this.builtinRows),
      migrationStateRows: structuredClone(this.migrationStateRows),
    };
    const releases: Array<() => void> = [];
    const transactionClient = Object.create(this) as FakePrisma & {
      $queryRaw: (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown[]>;
    };
    transactionClient.$queryRaw = async (_strings, ...values) => {
      releases.push(await this.acquireSubjectLock(String(values[0])));
      return [];
    };
    try {
      return await operation(transactionClient);
    } catch (error) {
      this.promptRows = snapshot.promptRows;
      this.builtinRows = snapshot.builtinRows;
      this.migrationStateRows = snapshot.migrationStateRows;
      throw error;
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
}

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

async function createPublicDir() {
  const directory = await mkdtemp(path.join(tmpdir(), "prompt-preset-migration-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeLegacyRows(
  publicDir: string,
  userId: string,
  scope: string,
  rows: unknown[],
) {
  const directory = path.join(publicDir, "uploads", "presets", userId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${scope}.json`),
    JSON.stringify(rows, null, 2),
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("legacy prompt preset migration", () => {
  it("imports every legacy scope row as user custom data", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "42", "image", [
      { id: "a", name: "图片同名", content: "图片内容" },
    ]);
    await writeLegacyRows(publicDir, "42", "video", [
      { id: "a", name: "视频同名", content: "视频内容" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });

    const result = await migration.ensureLegacyUserPromptsMigrated({
      authUserId: 42,
      presetUserIds: ["42", "42"],
    });

    expect(result).toEqual({ imported: 2, skipped: false });
    expect(prisma.promptRows).toEqual([
      expect.objectContaining({
        authUserId: 42,
        legacyKey: "json:image:a",
        name: "图片同名",
        content: "图片内容",
      }),
      expect.objectContaining({
        authUserId: 42,
        legacyKey: "json:video:a",
        name: "视频同名",
        content: "视频内容",
      }),
    ]);
  });

  it("imports and deduplicates multiple server-verified preset directories", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "42", "image", [
      { id: "account", name: "账号目录", content: "账号内容" },
    ]);
    await writeLegacyRows(publicDir, "legacy-device-a", "image", [
      { id: "device-a", name: "历史目录 A", content: "历史内容 A" },
    ]);
    await writeLegacyRows(publicDir, "legacy-device-b", "video", [
      { id: "device-b", name: "历史目录 B", content: "历史内容 B" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({
      prisma,
      publicDir,
      resolvePresetUserIds: async () => [
        "42",
        "legacy-device-a",
        "legacy-device-b",
      ],
    });

    const result = await migration.ensureLegacyUserPromptsMigrated({
      authUserId: 42,
      presetUserIds: [
        "legacy-device-a",
        "legacy-device-a",
        "legacy-device-b",
      ],
    });

    expect(result).toEqual({ imported: 3, skipped: false });
    expect(prisma.promptRows.map((row) => row.name).sort()).toEqual([
      "历史目录 A",
      "历史目录 B",
      "账号目录",
    ]);
    expect(prisma.migrationStateRows).toEqual([
      expect.objectContaining({
        subjectKey: "user:42:user-json",
        rowCount: 3,
      }),
    ]);
  });

  it("rejects unsafe legacy preset directory segments", async () => {
    const publicDir = await createPublicDir();
    const absoluteDirectory = path.resolve(publicDir, "..", "outside");

    await expect(
      scanLegacyPromptPresets({
        publicDir,
        presetUserIds: ["../outside"],
      }),
    ).rejects.toThrow("presetUserId");
    await expect(
      scanLegacyPromptPresets({
        publicDir,
        presetUserIds: [absoluteDirectory],
      }),
    ).rejects.toThrow("presetUserId");
  });

  it("rejects cross-user numeric and traversal preset directories", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "43", "image", [
      { id: "private", name: "其他用户", content: "不可导入" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });

    await expect(
      migration.ensureLegacyUserPromptsMigrated({
        authUserId: 42,
        presetUserIds: ["43"],
      }),
    ).rejects.toThrow("presetUserIds");
    await expect(
      migration.ensureLegacyUserPromptsMigrated({
        authUserId: 42,
        presetUserIds: ["../presets/43"],
      }),
    ).rejects.toThrow("presetUserIds");
    expect(prisma.promptRows).toEqual([]);
    expect(prisma.migrationStateRows).toEqual([]);
  });

  it("requires a positive safe integer authUserId", async () => {
    const publicDir = await createPublicDir();
    const invalidIds = [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1];

    for (const authUserId of invalidIds) {
      const prisma = new FakePrisma();
      const migration = createPromptPresetMigrationService({ prisma, publicDir });
      await expect(
        migration.ensureLegacyUserPromptsMigrated({
          authUserId,
          presetUserIds: [],
        }),
      ).rejects.toThrow("authUserId");
      expect(prisma.migrationStateRows).toEqual([]);
    }
  });

  it("requires a migrated category in the specified fallback order", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "7", "image", [
      {
        id: "category",
        name: "显式分类",
        content: "内容",
        category: "自定义分类",
        groupName: "不应使用",
      },
      { id: "group", name: "旧分组", content: "内容", groupName: "旧分组分类" },
    ]);
    await writeLegacyRows(publicDir, "7", "face_swap", [
      { id: "scope", name: "作用域", content: "内容" },
    ]);
    await writeLegacyRows(publicDir, "7", "unknown_scope", [
      { id: "unknown", name: "未知", content: "鎴戠殑鍘嗗彶鏂囧瓧" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });

    await migration.ensureLegacyUserPromptsMigrated({
      authUserId: 7,
      presetUserIds: [],
    });

    expect(
      Object.fromEntries(prisma.promptRows.map((row) => [row.legacyKey, row.category])),
    ).toEqual({
      "json:face_swap:scope": "人脸替换",
      "json:image:category": "自定义分类",
      "json:image:group": "旧分组分类",
      "json:unknown_scope:unknown": "未分类",
    });
    expect(
      prisma.promptRows.find((row) => row.legacyKey === "json:unknown_scope:unknown")
        ?.content,
    ).toBe("鎴戠殑鍘嗗彶鏂囧瓧");
  });

  it("is idempotent for the same digest and migration version", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "9", "image", [
      { id: "once", name: "只迁移一次", content: "内容" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });
    const input = { authUserId: 9, presetUserIds: ["9"] };

    const first = await migration.ensureLegacyUserPromptsMigrated(input);
    const second = await migration.ensureLegacyUserPromptsMigrated(input);

    expect(first).toEqual({ imported: 1, skipped: false });
    expect(second).toEqual({ imported: 0, skipped: true });
    expect(prisma.promptRows).toHaveLength(1);
    expect(prisma.migrationStateRows).toEqual([
      expect.objectContaining({
        subjectKey: "user:9:user-json",
        authUserId: 9,
        source: "user-json",
        version: 1,
        rowCount: 1,
      }),
    ]);
  });

  it("serializes concurrent first migration for the same subject and digest", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "12", "image", [
      { id: "concurrent", name: "并发迁移", content: "内容" },
    ]);
    const prisma = new FakePrisma();
    prisma.delayMigrationStateReads = true;
    prisma.delayPromptReads = true;
    const migration = createPromptPresetMigrationService({ prisma, publicDir });
    const input = { authUserId: 12, presetUserIds: ["12"] };

    const results = await Promise.all([
      migration.ensureLegacyUserPromptsMigrated(input),
      migration.ensureLegacyUserPromptsMigrated(input),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        { imported: 1, skipped: false },
        { imported: 0, skipped: true },
      ]),
    );
    expect(prisma.promptRows).toEqual([
      expect.objectContaining({
        legacyKey: "json:image:concurrent",
        revision: 1,
      }),
    ]);
    expect(prisma.migrationStateRows).toHaveLength(1);
  });

  it("synchronizes changed legacy source fields and increments revision", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "9", "image", [
      {
        id: "changed",
        name: "初始名称",
        category: "初始分类",
        content: "初始内容",
      },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });
    const input = { authUserId: 9, presetUserIds: ["9"] };
    await migration.ensureLegacyUserPromptsMigrated(input);
    await writeLegacyRows(publicDir, "9", "image", [
      {
        id: "changed",
        name: "新名称",
        category: "新分类",
        content: "新内容",
      },
    ]);

    const changed = await migration.ensureLegacyUserPromptsMigrated(input);
    const unchanged = await migration.ensureLegacyUserPromptsMigrated(input);

    expect(changed).toEqual({ imported: 0, skipped: false });
    expect(unchanged).toEqual({ imported: 0, skipped: true });
    expect(prisma.promptRows).toEqual([
      expect.objectContaining({
        legacyKey: "json:image:changed",
        name: "新名称",
        category: "新分类",
        content: "新内容",
        revision: 2,
      }),
    ]);
  });

  it("rolls back changed user rows and migration state when an upsert fails", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "10", "image", [
      { id: "atomic", name: "初始名称", content: "初始内容" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });
    const input = { authUserId: 10, presetUserIds: ["10"] };
    await migration.ensureLegacyUserPromptsMigrated(input);
    const before = {
      rows: structuredClone(prisma.promptRows),
      states: structuredClone(prisma.migrationStateRows),
    };
    await writeLegacyRows(publicDir, "10", "image", [
      { id: "atomic", name: "新名称", content: "新内容" },
    ]);
    prisma.failPromptUpsertAfterWrite = true;

    await expect(
      migration.ensureLegacyUserPromptsMigrated(input),
    ).rejects.toThrow("prompt upsert failed");

    expect(prisma.promptRows).toEqual(before.rows);
    expect(prisma.migrationStateRows).toEqual(before.states);
  });

  it("writes user rows and migration state atomically", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "11", "image", [
      { id: "rollback", name: "事务回滚", content: "内容" },
    ]);
    const prisma = new FakePrisma();
    prisma.failMigrationStateWrite = true;
    const migration = createPromptPresetMigrationService({ prisma, publicDir });

    await expect(
      migration.ensureLegacyUserPromptsMigrated({
        authUserId: 11,
        presetUserIds: ["11"],
      }),
    ).rejects.toThrow("state write failed");

    expect(prisma.promptRows).toEqual([]);
    expect(prisma.migrationStateRows).toEqual([]);
  });

  it("imports legacy builtins into one global builtin table", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "_builtin", "image", [
      { id: "same", name: "图片内置", content: "图片内容" },
    ]);
    await writeLegacyRows(publicDir, "_builtin", "video", [
      { id: "same", name: "视频内置", content: "视频内容" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });

    const result = await migration.ensureLegacyBuiltinPromptsMigrated();

    expect(result).toEqual({ imported: 2, skipped: false });
    expect(prisma.builtinRows).toEqual([
      expect.objectContaining({ key: "legacy:image:same", category: "图片编辑" }),
      expect.objectContaining({ key: "legacy:video:same", category: "视频生成" }),
    ]);
    expect(prisma.builtinRows.every((row) => !("scope" in row))).toBe(true);
  });

  it("does not overwrite an administrator-edited builtin with the same key", async () => {
    const publicDir = await createPublicDir();
    await writeLegacyRows(publicDir, "_builtin", "image", [
      { id: "stable", name: "初始名称", content: "初始内容" },
    ]);
    const prisma = new FakePrisma();
    const migration = createPromptPresetMigrationService({ prisma, publicDir });
    await migration.ensureLegacyBuiltinPromptsMigrated();
    prisma.builtinRows[0].name = "管理员名称";
    prisma.builtinRows[0].content = "管理员内容";
    await writeLegacyRows(publicDir, "_builtin", "image", [
      { id: "stable", name: "源文件新名称", content: "源文件新内容" },
    ]);

    const result = await migration.ensureLegacyBuiltinPromptsMigrated();

    expect(result).toEqual({ imported: 0, skipped: false });
    expect(prisma.builtinRows).toEqual([
      expect.objectContaining({
        key: "legacy:image:stable",
        name: "管理员名称",
        content: "管理员内容",
      }),
    ]);
  });

  it("runs dry-run without changing source files", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "prompt-preset-cli-"));
    temporaryDirectories.push(projectRoot);
    const publicDir = path.join(projectRoot, "public");
    await mkdir(path.join(projectRoot, "app"), { recursive: true });
    await mkdir(publicDir, { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), "{}", "utf8");
    await writeLegacyRows(publicDir, "15", "image", [
      { id: "dry", name: "只读扫描", content: "内容" },
    ]);
    await writeLegacyRows(publicDir, "guest-device", "video", [
      { id: "guest", name: "不可猜归属", content: "内容" },
    ]);
    const seedPath = path.join(
      projectRoot,
      "config",
      "prompt-presets",
      "canvas-v1.json",
    );
    await mkdir(path.dirname(seedPath), { recursive: true });
    await writeFile(
      seedPath,
      JSON.stringify({
        version: 1,
        presets: [
          {
            key: "canvas:dry",
            name: "画布",
            category: "视角",
            content: "内容",
          },
        ],
      }),
      "utf8",
    );
    const userSource = path.join(
      publicDir,
      "uploads",
      "presets",
      "15",
      "image.json",
    );
    const before = {
      user: await readFile(userSource, "utf8"),
      canvas: await readFile(seedPath, "utf8"),
    };
    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

    const { stdout } = await execFileAsync(
      process.execPath,
      [tsxCli, "scripts/migrate-prompt-presets.ts", "--dry-run"],
      {
        cwd: process.cwd(),
        env: { ...process.env, APP_ROOT_DIR: projectRoot },
      },
    );

    expect(stdout).toContain("dry-run 完成：未写入数据库，未修改源文件。");
    expect(stdout).toContain("跳过非数字 guest 目录: guest-device");
    expect(await readFile(userSource, "utf8")).toBe(before.user);
    expect(await readFile(seedPath, "utf8")).toBe(before.canvas);
  });
});
