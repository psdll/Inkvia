import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRootDir } from "@/lib/public-path";

type CanvasSeed = {
  key: string;
  name: string;
  category: string;
  content: string;
};

type CanvasSeedFile = {
  version: number;
  presets: CanvasSeed[];
};

function parseCanvasSeedFile(raw: string): CanvasSeedFile {
  const parsed = JSON.parse(raw) as Partial<CanvasSeedFile>;
  if (
    !Number.isSafeInteger(parsed.version) ||
    !Array.isArray(parsed.presets) ||
    parsed.presets.some(
      (preset) =>
        !preset ||
        typeof preset.key !== "string" ||
        !preset.key.startsWith("canvas:") ||
        typeof preset.name !== "string" ||
        !preset.name.trim() ||
        typeof preset.category !== "string" ||
        !preset.category.trim() ||
        typeof preset.content !== "string" ||
        !preset.content.trim(),
    )
  ) {
    throw new Error("画布提示词种子格式无效");
  }
  return parsed as CanvasSeedFile;
}

/**
 * Built-in presets are deployment data, not code: a fresh install may have no seed
 * file at all. Then there are simply no built-in presets and users add their own.
 */
export async function scanCanvasPromptSeeds(seedPath: string) {
  let raw: string;
  try {
    raw = await readFile(seedPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 0, presets: [] as CanvasSeed[], digest: null, missing: true as const };
    }
    throw error;
  }
  const seedFile = parseCanvasSeedFile(raw);
  return {
    ...seedFile,
    digest: crypto.createHash("sha256").update(raw).digest("hex"),
    missing: false as const,
  };
}

export function createCanvasPromptSeedService(input: {
  prisma: any;
  seedPath: string;
}) {
  async function ensureCanvasPromptSeeds() {
    const scan = await scanCanvasPromptSeeds(input.seedPath);
    if (scan.missing) return { imported: 0, skipped: true };
    const subjectKey = "global:canvas-json";
    return input.prisma.$transaction(async (tx: any) => {
      const state = await tx.promptPresetMigrationState.findUnique({
        where: { subjectKey },
      });
      if (state?.digest === scan.digest && state.version === scan.version) {
        return { imported: 0, skipped: true };
      }

      const writeResult = scan.presets.length
        ? await tx.builtinPromptPreset.createMany({
            data: scan.presets,
            skipDuplicates: true,
          })
        : { count: 0 };
      await tx.promptPresetMigrationState.upsert({
        where: { subjectKey },
        create: {
          subjectKey,
          authUserId: null,
          source: "canvas-json",
          version: scan.version,
          digest: scan.digest,
          rowCount: scan.presets.length,
        },
        update: {
          authUserId: null,
          source: "canvas-json",
          version: scan.version,
          digest: scan.digest,
          rowCount: scan.presets.length,
          completedAt: new Date(),
        },
      });
      return { imported: writeResult.count, skipped: false };
    });
  }

  return { ensureCanvasPromptSeeds };
}

function defaultSeedPath() {
  return path.join(
    resolveProjectRootDir(),
    "config",
    "prompt-presets",
    "canvas-v1.json",
  );
}

export async function ensureCanvasPromptSeeds(): Promise<{
  imported: number;
  skipped: boolean;
}> {
  const { default: prisma } = await import("@/lib/prisma");
  return createCanvasPromptSeedService({
    prisma,
    seedPath: defaultSeedPath(),
  }).ensureCanvasPromptSeeds();
}
