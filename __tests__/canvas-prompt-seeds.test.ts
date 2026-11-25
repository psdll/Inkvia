import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeCanvasPromptContent } from "@/lib/prompt-presets/contracts";
import { createCanvasPromptSeedService } from "@/lib/prompt-presets/builtin-seeds";
import { isPublicExport } from "./support/public-export";

type BuiltinRow = {
  key: string;
  name: string;
  category: string;
  content: string;
};

type MigrationStateRow = {
  subjectKey: string;
  authUserId: null;
  source: string;
  version: number;
  digest: string;
  rowCount: number;
};

class FakePrisma {
  builtinRows: BuiltinRow[] = [];
  migrationStateRows: MigrationStateRow[] = [];

  builtinPromptPreset = {
    createMany: async ({ data }: { data: BuiltinRow[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (this.builtinRows.some((candidate) => candidate.key === row.key)) continue;
        this.builtinRows.push({ ...row });
        count += 1;
      }
      return { count };
    },
  };

  promptPresetMigrationState = {
    findUnique: async ({ where }: { where: { subjectKey: string } }) =>
      this.migrationStateRows.find((row) => row.subjectKey === where.subjectKey) ?? null,
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { subjectKey: string };
      create: MigrationStateRow;
      update: Omit<MigrationStateRow, "subjectKey">;
    }) => {
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

  async $transaction<T>(operation: (tx: FakePrisma) => Promise<T>) {
    return operation(this);
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("normalized canvas prompt seeds", () => {
  it.skipIf(isPublicExport)("merges canvas prompts, maps readable categories, and discards params and tags", () => {
    const source = JSON.parse(
      readFileSync("public/canvas-templates/builtin.json", "utf8"),
    );
    const normalized = JSON.parse(
      readFileSync("config/prompt-presets/canvas-v1.json", "utf8"),
    );
    const categoryNames = new Map(
      source.categories.map((category: { id: string; name: string }) => [
        category.id,
        category.name,
      ]),
    );

    expect(normalized.version).toBe(1);
    expect(normalized.presets).toHaveLength(source.templates.length);
    expect(normalized.presets).toEqual(
      source.templates.map(
        (template: {
          id: string;
          category: string;
          name: string;
          positive: string;
          negative: string;
        }) => ({
          key: `canvas:${template.id}`,
          name: template.name,
          category: categoryNames.get(template.category) ?? "画布",
          content: mergeCanvasPromptContent(template.positive, template.negative),
        }),
      ),
    );
    expect(JSON.stringify(normalized)).not.toMatch(
      /"(?:positive|negative|params|tags)"\s*:/,
    );
  });

  it("treats a deployment without a seed file as having no built-in presets", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "canvas-prompt-seeds-"));
    temporaryDirectories.push(directory);
    const prisma = new FakePrisma();
    const seeds = createCanvasPromptSeedService({ prisma, seedPath: path.join(directory, "canvas-v1.json") });
    await expect(seeds.ensureCanvasPromptSeeds()).resolves.toEqual({ imported: 0, skipped: true });
    expect(prisma.builtinRows).toEqual([]);
    expect(prisma.migrationStateRows).toEqual([]);
  });

  it("creates only missing canvas keys and preserves administrator edits", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "canvas-prompt-seeds-"));
    temporaryDirectories.push(directory);
    const seedPath = path.join(directory, "canvas-v1.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        version: 1,
        presets: [
          {
            key: "canvas:stable",
            name: "初始名称",
            category: "视角",
            content: "初始内容",
          },
        ],
      }),
      "utf8",
    );
    const prisma = new FakePrisma();
    const seeds = createCanvasPromptSeedService({ prisma, seedPath });
    const first = await seeds.ensureCanvasPromptSeeds();
    prisma.builtinRows[0].name = "管理员名称";
    prisma.builtinRows[0].content = "管理员内容";
    await writeFile(
      seedPath,
      JSON.stringify({
        version: 1,
        presets: [
          {
            key: "canvas:stable",
            name: "源文件新名称",
            category: "视角",
            content: "源文件新内容",
          },
          {
            key: "canvas:new",
            name: "新增种子",
            category: "分镜",
            content: "新增内容",
          },
        ],
      }),
      "utf8",
    );

    const second = await seeds.ensureCanvasPromptSeeds();
    const third = await seeds.ensureCanvasPromptSeeds();

    expect(first).toEqual({ imported: 1, skipped: false });
    expect(second).toEqual({ imported: 1, skipped: false });
    expect(third).toEqual({ imported: 0, skipped: true });
    expect(prisma.builtinRows).toEqual([
      {
        key: "canvas:stable",
        name: "管理员名称",
        category: "视角",
        content: "管理员内容",
      },
      {
        key: "canvas:new",
        name: "新增种子",
        category: "分镜",
        content: "新增内容",
      },
    ]);
    expect(prisma.migrationStateRows).toEqual([
      expect.objectContaining({
        subjectKey: "global:canvas-json",
        authUserId: null,
        source: "canvas-json",
        version: 1,
        rowCount: 2,
      }),
    ]);
  });
});
