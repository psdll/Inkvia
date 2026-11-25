import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { resolvePublicDir } from "@/lib/public-path";

export const PROMPT_PRESET_MIGRATION_VERSION = 1;

type LegacyPromptRow = {
  legacyId: string;
  name: string;
  category: string;
  content: string;
  scope: string;
};

export type LegacyPromptScan = {
  version: number;
  digest: string;
  fileCount: number;
  validCount: number;
  invalidCount: number;
  duplicateIds: string[];
  duplicateNames: string[];
  rows: LegacyPromptRow[];
};

type MigrationResult = {
  imported: number;
  skipped: boolean;
};

const LEGACY_SCOPE_LABELS: Record<string, string> = {
  face_swap: "人脸替换",
  face_defect: "添加瑕疵",
  face_swap_defect: "替换并加瑕疵",
  image: "图片编辑",
  video: "视频生成",
  image_batch: "批量",
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readableLegacyScope(scope: string) {
  return LEGACY_SCOPE_LABELS[scope] ?? "";
}

function normalizeLegacyRow(value: unknown, scope: string): LegacyPromptRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !nonEmptyString(row.id) ||
    !nonEmptyString(row.name) ||
    !nonEmptyString(row.content)
  ) {
    return null;
  }

  const category = nonEmptyString(row.category)
    ? row.category
    : nonEmptyString(row.groupName)
      ? row.groupName
      : readableLegacyScope(scope) || "未分类";
  const legacyKey = `json:${scope}:${row.id}`;
  if (
    row.name.length > 128 ||
    category.length > 64 ||
    row.content.length > 10_000 ||
    legacyKey.length > 256
  ) {
    return null;
  }

  return {
    legacyId: row.id,
    name: row.name,
    category,
    content: row.content,
    scope,
  };
}

function repeatedValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b));
}

function resolveLegacyPresetDirectory(publicDir: string, presetUserId: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(presetUserId)) {
    throw new Error("presetUserId 必须是安全的单一路径段");
  }
  const presetsRoot = path.resolve(publicDir, "uploads", "presets");
  const directory = path.resolve(presetsRoot, presetUserId);
  const relative = path.relative(presetsRoot, directory);
  if (
    relative !== presetUserId ||
    path.isAbsolute(relative) ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error("presetUserId 路径超出预设目录");
  }
  return directory;
}

export async function scanLegacyPromptPresets(input: {
  publicDir: string;
  presetUserIds: string[];
}): Promise<LegacyPromptScan> {
  const presetUserIds = [...new Set(input.presetUserIds)].sort((a, b) =>
    a.localeCompare(b),
  );
  const sourceFiles: Array<{ relativePath: string; raw: string }> = [];
  const rows: LegacyPromptRow[] = [];
  let invalidCount = 0;

  for (const presetUserId of presetUserIds) {
    const directory = resolveLegacyPresetDirectory(input.publicDir, presetUserId);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const file of files) {
      const filePath = path.join(directory, file.name);
      const relativePath = path
        .relative(input.publicDir, filePath)
        .split(path.sep)
        .join("/");
      const raw = await readFile(filePath, "utf8");
      sourceFiles.push({ relativePath, raw });
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        invalidCount += 1;
        continue;
      }
      if (!Array.isArray(parsed)) {
        invalidCount += 1;
        continue;
      }
      const scope = path.basename(file.name, path.extname(file.name));
      for (const value of parsed) {
        const row = normalizeLegacyRow(value, scope);
        if (row) rows.push(row);
        else invalidCount += 1;
      }
    }
  }

  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(sourceFiles))
    .digest("hex");
  return {
    version: PROMPT_PRESET_MIGRATION_VERSION,
    digest,
    fileCount: sourceFiles.length,
    validCount: rows.length,
    invalidCount,
    duplicateIds: repeatedValues(rows.map((row) => row.legacyId)),
    duplicateNames: repeatedValues(rows.map((row) => row.name)),
    rows,
  };
}

function stateMatches(
  state: { digest: string; version: number } | null,
  scan: LegacyPromptScan,
) {
  return state?.digest === scan.digest && state.version === scan.version;
}

export function createPromptPresetMigrationService(input: {
  prisma: any;
  publicDir: string;
  resolvePresetUserIds?: (authUserId: number) => Promise<string[]>;
}) {
  async function migrateUserPrompts(
    authUserId: number,
    scan: LegacyPromptScan,
  ): Promise<MigrationResult> {
    const subjectKey = `user:${authUserId}:user-json`;
    return input.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${subjectKey}))::text
      `;
      const state = await tx.promptPresetMigrationState.findUnique({
        where: { subjectKey },
      });
      if (stateMatches(state, scan)) return { imported: 0, skipped: true };

      let imported = 0;
      for (const row of scan.rows) {
        const legacyKey = `json:${row.scope}:${row.legacyId}`;
        const where = {
          authUserId_legacyKey: { authUserId, legacyKey },
        };
        const existing = await tx.promptPreset.findUnique({
          where,
          select: { name: true, category: true, content: true },
        });
        if (
          existing?.name === row.name &&
          existing.category === row.category &&
          existing.content === row.content
        ) {
          continue;
        }
        await tx.promptPreset.upsert({
          where,
          create: {
            authUserId,
            name: row.name,
            category: row.category,
            content: row.content,
            legacyKey,
          },
          update: {
            name: row.name,
            category: row.category,
            content: row.content,
            revision: { increment: 1 },
          },
        });
        if (!existing) imported += 1;
      }
      await tx.promptPresetMigrationState.upsert({
        where: { subjectKey },
        create: {
          subjectKey,
          authUserId,
          source: "user-json",
          version: scan.version,
          digest: scan.digest,
          rowCount: scan.validCount,
        },
        update: {
          authUserId,
          source: "user-json",
          version: scan.version,
          digest: scan.digest,
          rowCount: scan.validCount,
          completedAt: new Date(),
        },
      });
      return { imported, skipped: false };
    });
  }

  async function ensureLegacyUserPromptsMigrated(userInput: {
    authUserId: number;
    presetUserIds: string[];
  }): Promise<MigrationResult> {
    if (
      !Number.isSafeInteger(userInput.authUserId) ||
      userInput.authUserId <= 0
    ) {
      throw new Error("authUserId 必须是正安全整数");
    }
    const presetUserId = String(userInput.authUserId);
    const resolvePresetUserIds =
      input.resolvePresetUserIds ??
      (async (authUserId: number) => [String(authUserId)]);
    const verifiedPresetUserIds = new Set([
      presetUserId,
      ...(await resolvePresetUserIds(userInput.authUserId)),
    ]);
    for (const verifiedPresetUserId of verifiedPresetUserIds) {
      resolveLegacyPresetDirectory(input.publicDir, verifiedPresetUserId);
    }
    const requestedPresetUserIds = [...new Set(userInput.presetUserIds)];
    if (
      requestedPresetUserIds.some(
        (value) => !verifiedPresetUserIds.has(value),
      )
    ) {
      throw new Error("presetUserIds 不能包含其他用户目录");
    }
    const scan = await scanLegacyPromptPresets({
      publicDir: input.publicDir,
      presetUserIds: [presetUserId, ...requestedPresetUserIds],
    });
    return migrateUserPrompts(userInput.authUserId, scan);
  }

  async function ensureLegacyBuiltinPromptsMigrated(): Promise<MigrationResult> {
    const scan = await scanLegacyPromptPresets({
      publicDir: input.publicDir,
      presetUserIds: ["_builtin"],
    });
    const subjectKey = "global:builtin-json";
    return input.prisma.$transaction(async (tx: any) => {
      const state = await tx.promptPresetMigrationState.findUnique({
        where: { subjectKey },
      });
      if (stateMatches(state, scan)) return { imported: 0, skipped: true };

      const writeResult = scan.rows.length
        ? await tx.builtinPromptPreset.createMany({
            data: scan.rows.map((row) => ({
              key: `legacy:${row.scope}:${row.legacyId}`,
              name: row.name,
              category: row.category,
              content: row.content,
            })),
            skipDuplicates: true,
          })
        : { count: 0 };
      await tx.promptPresetMigrationState.upsert({
        where: { subjectKey },
        create: {
          subjectKey,
          authUserId: null,
          source: "builtin-json",
          version: scan.version,
          digest: scan.digest,
          rowCount: scan.validCount,
        },
        update: {
          authUserId: null,
          source: "builtin-json",
          version: scan.version,
          digest: scan.digest,
          rowCount: scan.validCount,
          completedAt: new Date(),
        },
      });
      return { imported: writeResult.count, skipped: false };
    });
  }

  return {
    ensureLegacyUserPromptsMigrated,
    ensureLegacyBuiltinPromptsMigrated,
  };
}

async function defaultService() {
  const { default: prisma } = await import("@/lib/prisma");
  const { resolveAdminUserScope } = await import("@/lib/admin-user-scope");
  return createPromptPresetMigrationService({
    prisma,
    publicDir: resolvePublicDir(),
    resolvePresetUserIds: async (authUserId) =>
      (
        await resolveAdminUserScope(String(authUserId), authUserId, {
          explicitIdentity: true,
        })
      ).presetUserIds,
  });
}

export async function ensureLegacyUserPromptsMigrated(input: {
  authUserId: number;
  presetUserIds: string[];
}): Promise<MigrationResult> {
  return (await defaultService()).ensureLegacyUserPromptsMigrated(input);
}

export async function ensureLegacyBuiltinPromptsMigrated(): Promise<MigrationResult> {
  return (await defaultService()).ensureLegacyBuiltinPromptsMigrated();
}
