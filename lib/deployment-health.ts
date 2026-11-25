import "server-only";

import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";

export const DEPLOYMENT_ENV_KEYS = [
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "ADMIN_SECRET",
  "DATABASE_URL",
  "UPLOADS_DIR",
  "IMPORTS_DIR",
  "EXPORTS_DIR",
] as const;

const RELEASE_METADATA = "config/deploy/release-metadata.json";
const UPLOADS_SENTINEL = ".inkvia-uploads";
const UPLOADS_SENTINEL_CONTENT = "INKVIA_UPLOADS_V1\n";
const MAX_METADATA_BYTES = 1024 * 1024;
const VERSION_RE = /^Inkvia-v\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const MIGRATION_RE = /^\d+_[A-Za-z0-9_\-\u0080-\u{10ffff}]+$/u;

type EnvironmentStatus = "SET" | "MISSING";
type DeploymentDatabaseStatus = "OK" | "UNAVAILABLE";
type DeploymentMigrationStatus = "OK" | "DRIFT" | "UNAVAILABLE";
type DeploymentUploadsStatus = "OK" | "INVALID";

export type DeploymentHealthBody = {
  version: string | null;
  commit: string | null;
  database: DeploymentDatabaseStatus;
  migrations: DeploymentMigrationStatus;
  environment: Record<(typeof DEPLOYMENT_ENV_KEYS)[number], EnvironmentStatus>;
  uploads: DeploymentUploadsStatus;
};

type DeploymentDb = {
  $queryRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

type MigrationRow = {
  migration_name: unknown;
  finished_at: unknown;
  rolled_back_at: unknown;
};

export type DeploymentHealthInput = {
  db?: DeploymentDb;
  env?: Record<string, string | undefined>;
  installedRoot?: string;
  expectedUploadsPath?: string;
  expectedUid?: number;
  expectedGid?: number;
  metadataOwnerUid?: number;
};

function bytewiseCompare(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function requireOwnedRealDirectory(directory: string, ownerUid: number) {
  const metadata = await fs.lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new Error("unsafe directory");
  if (
    process.platform !== "win32" &&
    (metadata.uid !== ownerUid || (metadata.mode & 0o022) !== 0)
  ) {
    throw new Error("unsafe directory metadata");
  }
}

async function readNoFollowBoundedFile(filePath: string, maximum: number) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
  try {
    const before = await fs.lstat(filePath);
    const opened = await handle.stat();
    if (
      before.isSymbolicLink() ||
      !opened.isFile() ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino ||
      opened.size < 1 ||
      opened.size > maximum
    ) {
      throw new Error("unsafe file");
    }
    const content = await handle.readFile();
    const after = await fs.lstat(filePath);
    if (
      content.length !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) {
      throw new Error("file changed");
    }
    return { content, metadata: opened };
  } finally {
    await handle.close();
  }
}

async function installedMetadata(
  installedRoot: string,
  ownerUid: number,
): Promise<{ version: string; commit: string } | null> {
  try {
    await requireOwnedRealDirectory(installedRoot, ownerUid);
    await requireOwnedRealDirectory(
      path.join(installedRoot, "config"),
      ownerUid,
    );
    await requireOwnedRealDirectory(
      path.join(installedRoot, "config", "deploy"),
      ownerUid,
    );
    const filePath = path.join(installedRoot, ...RELEASE_METADATA.split("/"));
    const { content, metadata } = await readNoFollowBoundedFile(
      filePath,
      MAX_METADATA_BYTES,
    );
    if (
      process.platform !== "win32" &&
      (metadata.uid !== ownerUid || (metadata.mode & 0o022) !== 0)
    ) {
      return null;
    }
    const parsed = JSON.parse(content.toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !VERSION_RE.test(parsed.version) ||
      !COMMIT_RE.test(parsed.gitCommit)
    ) {
      return null;
    }
    return { version: parsed.version, commit: parsed.gitCommit };
  } catch {
    return null;
  }
}

async function candidateMigrationNames(
  installedRoot: string,
  ownerUid: number,
) {
  const migrationsRoot = path.join(installedRoot, "prisma", "migrations");
  await requireOwnedRealDirectory(installedRoot, ownerUid);
  await requireOwnedRealDirectory(path.join(installedRoot, "prisma"), ownerUid);
  await requireOwnedRealDirectory(migrationsRoot, ownerUid);
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  if (
    entries.some(
      (entry) => MIGRATION_RE.test(entry.name) && !entry.isDirectory(),
    )
  ) {
    throw new Error("invalid migration entry");
  }
  return entries
    .filter((entry) => entry.isDirectory() && MIGRATION_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort(bytewiseCompare);
}

function migrationRowsMatch(rows: unknown, expected: string[]) {
  if (!Array.isArray(rows) || rows.length !== expected.length) return false;
  const names = rows.map((row) => {
    const candidate = row as MigrationRow;
    if (
      !candidate ||
      typeof candidate.migration_name !== "string" ||
      !candidate.finished_at ||
      candidate.rolled_back_at
    ) {
      return null;
    }
    return candidate.migration_name;
  });
  return names.every((name, index) => name === expected[index]);
}

async function uploadsStatus(
  env: Record<string, string | undefined>,
  expectedPath: string,
  expectedUid: number,
  expectedGid: number,
): Promise<DeploymentUploadsStatus> {
  try {
    const configured = String(env.UPLOADS_DIR || "");
    if (
      configured !== expectedPath ||
      path.resolve(configured) !== expectedPath
    ) {
      return "INVALID";
    }
    const metadata = await fs.lstat(configured);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return "INVALID";
    if (
      process.platform !== "win32" &&
      (metadata.uid !== expectedUid ||
        metadata.gid !== expectedGid ||
        (metadata.mode & 0o002) !== 0 ||
        (metadata.mode & 0o700) !== 0o700)
    ) {
      return "INVALID";
    }
    if ((await fs.realpath(configured)) !== expectedPath) return "INVALID";
    const { content, metadata: sentinel } = await readNoFollowBoundedFile(
      path.join(configured, UPLOADS_SENTINEL),
      Buffer.byteLength(UPLOADS_SENTINEL_CONTENT),
    );
    if (
      !sentinel.isFile() ||
      content.toString("utf8") !== UPLOADS_SENTINEL_CONTENT
    ) {
      return "INVALID";
    }
    return "OK";
  } catch {
    return "INVALID";
  }
}

export async function runDeploymentHealth(
  input: DeploymentHealthInput = {},
): Promise<{ ok: boolean; body: DeploymentHealthBody }> {
  const db = (input.db ?? (prisma as unknown as DeploymentDb)) as DeploymentDb;
  const env = input.env ?? process.env;
  const installedRoot = input.installedRoot ?? path.resolve(env.APP_ROOT_DIR || process.cwd());
  const expectedUploadsPath = input.expectedUploadsPath ?? path.resolve(env.UPLOADS_DIR || path.join(installedRoot, "public", "uploads"));
  const expectedUid = input.expectedUid ?? process.getuid?.() ?? 0;
  const expectedGid = input.expectedGid ?? process.getgid?.() ?? 0;
  const metadataOwnerUid = input.metadataOwnerUid ?? 0;
  const metadata = await installedMetadata(installedRoot, metadataOwnerUid);
  const environment = Object.fromEntries(
    DEPLOYMENT_ENV_KEYS.map((key) => [
      key,
      String(env[key] || "").trim() ? "SET" : "MISSING",
    ]),
  ) as DeploymentHealthBody["environment"];

  let database: DeploymentDatabaseStatus = "UNAVAILABLE";
  let migrations: DeploymentMigrationStatus = "UNAVAILABLE";
  try {
    const rows = (await db.$queryRaw`SELECT 1 AS ok`) as Array<{ ok: unknown }>;
    if (Array.isArray(rows) && rows[0]?.ok === 1) database = "OK";
  } catch {
    database = "UNAVAILABLE";
  }
  if (database === "OK") {
    try {
      const expected = await candidateMigrationNames(
        installedRoot,
        metadataOwnerUid,
      );
      const rows = (await db.$queryRaw`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY migration_name COLLATE "C"
      `) as MigrationRow[];
      migrations = migrationRowsMatch(rows, expected) ? "OK" : "DRIFT";
    } catch {
      migrations = "UNAVAILABLE";
    }
  }

  const uploads = await uploadsStatus(
    env,
    expectedUploadsPath,
    expectedUid,
    expectedGid,
  );
  const body: DeploymentHealthBody = {
    version: metadata?.version ?? null,
    commit: metadata?.commit ?? null,
    database,
    migrations,
    environment,
    uploads,
  };
  const ok =
    metadata !== null &&
    database === "OK" &&
    migrations === "OK" &&
    uploads === "OK" &&
    Object.values(environment).every((value) => value === "SET");
  return { ok, body };
}
