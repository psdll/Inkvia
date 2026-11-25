import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import type { RoleSkillWorkspace } from "@/lib/role-skills/contracts";
import {
  createDefaultSkillWorkspace,
  MAX_ROLE_SKILL_WORKSPACE_FILE_CHARS,
  normalizeSkillWorkspace,
  normalizeSkillWorkspacePath,
  ROLE_SKILL_WORKSPACE_MANIFEST,
} from "@/lib/role-skills/skill-workspace";
import { resolveLocalUploadDirectory } from "@/lib/storage";
import {
  roleSkillSystemWorkspaceFolder,
  roleSkillUserWorkspaceFolder,
} from "@/lib/upload-buckets";

export type RoleSkillWorkspaceScope =
  | { source: "system"; skillId: bigint }
  | { source: "personal"; authUserId: number; skillId: bigint };

type WorkspaceManifest = {
  version: 1;
  primaryPath: string | null;
};

function workspaceFolder(scope: RoleSkillWorkspaceScope) {
  if (scope.source === "system") {
    return roleSkillSystemWorkspaceFolder(scope.skillId);
  }
  return roleSkillUserWorkspaceFolder(scope.authUserId, scope.skillId);
}

function resolveWorkspaceDirectory(scope: RoleSkillWorkspaceScope) {
  return resolveLocalUploadDirectory(workspaceFolder(scope));
}

function resolveWorkspaceChild(root: string, relativePath: string) {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("技能工作区文件路径无效");
  }
  return target;
}

async function readManifest(root: string): Promise<WorkspaceManifest | null> {
  try {
    const raw = await fs.readFile(path.join(root, ROLE_SKILL_WORKSPACE_MANIFEST), "utf8");
    const value = JSON.parse(raw) as Partial<WorkspaceManifest>;
    return value.version === 1
      ? { version: 1, primaryPath: typeof value.primaryPath === "string" ? value.primaryPath : null }
      : null;
  } catch {
    return null;
  }
}

async function scanWorkspaceDirectory(
  root: string,
  current: string,
  files: Array<{ path: string; content: string }>,
  directories: string[],
) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  for (const entry of entries) {
    if (entry.name === ROLE_SKILL_WORKSPACE_MANIFEST) continue;
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      directories.push(relativePath);
      await scanWorkspaceDirectory(root, absolutePath, files, directories);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await fs.stat(absolutePath);
    if (stats.size > MAX_ROLE_SKILL_WORKSPACE_FILE_CHARS * 4) {
      throw new Error(`技能工作区文件过大：${relativePath}`);
    }
    const content = await fs.readFile(absolutePath, "utf8");
    if (content.includes("\u0000")) {
      throw new Error(`技能工作区文件不是可读取文本：${relativePath}`);
    }
    files.push({ path: relativePath, content });
  }
}

export async function readRoleSkillWorkspace(
  scope: RoleSkillWorkspaceScope,
  fallbackContent: string,
): Promise<RoleSkillWorkspace> {
  const root = resolveWorkspaceDirectory(scope);
  if (!await fs.pathExists(root)) return createDefaultSkillWorkspace(fallbackContent);

  const files: Array<{ path: string; content: string }> = [];
  const directories: string[] = [];
  await scanWorkspaceDirectory(root, root, files, directories);
  if (files.length === 0) return createDefaultSkillWorkspace(fallbackContent);
  const manifest = await readManifest(root);
  return normalizeSkillWorkspace({
    files,
    directories,
    primaryPath: manifest?.primaryPath || null,
  }, fallbackContent);
}

/** Enumerate names only, then open one regular file within the verified workspace. */
export async function readRoleSkillWorkspaceDocument(scope: RoleSkillWorkspaceScope, fallbackContent: string, selectedPath?: string) {
  const root = resolveWorkspaceDirectory(scope);
  if (!await fs.pathExists(root)) {
    if (selectedPath && selectedPath !== "SKILL.md") throw new Error("资料不在该技能目录内");
    return { primaryPath: "SKILL.md", files: ["SKILL.md"], path: "SKILL.md", content: fallbackContent };
  }
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error("技能工作区不能是符号链接");
  const paths: string[] = [];
  const list = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ROLE_SKILL_WORKSPACE_MANIFEST || entry.isSymbolicLink()) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await list(target);
      else if (entry.isFile()) paths.push(path.relative(root, target).split(path.sep).join("/"));
    }
  };
  await list(root); paths.sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (!paths.length) {
    if (selectedPath && selectedPath !== "SKILL.md") throw new Error("资料不在该技能目录内");
    return { primaryPath: "SKILL.md", files: ["SKILL.md"], path: "SKILL.md", content: fallbackContent };
  }
  const manifest = await readManifest(root);
  const primaryPath = manifest?.primaryPath && paths.includes(manifest.primaryPath) ? manifest.primaryPath : paths.includes("SKILL.md") ? "SKILL.md" : paths[0];
  const selected = selectedPath ? normalizeSkillWorkspacePath(selectedPath) : primaryPath;
  if (selectedPath && selected !== selectedPath) throw new Error("请使用目录中列出的原始路径");
  if (!paths.includes(selected)) throw new Error("资料不在该技能目录内");
  let current = root;
  for (const part of selected.split("/")) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("技能资料不能是符号链接");
  }
  const canonicalRoot = await fs.realpath(root);
  const target = resolveWorkspaceChild(canonicalRoot, selected);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    const actual = await fs.realpath(target);
    const relative = path.relative(canonicalRoot, actual);
    const currentStat = await fs.lstat(target);
    if (!stat.isFile() || currentStat.isSymbolicLink() || stat.ino !== currentStat.ino || stat.dev !== currentStat.dev || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("技能资料路径已变化");
    if (stat.size > MAX_ROLE_SKILL_WORKSPACE_FILE_CHARS * 4) throw new Error("技能资料过大");
    const content = await handle.readFile("utf8");
    if (content.includes("\u0000")) throw new Error("技能资料不是文本");
    return { primaryPath, files: paths, path: selected, content };
  } finally { await handle.close(); }
}

async function writeWorkspaceDirectory(root: string, workspace: RoleSkillWorkspace) {
  await fs.ensureDir(root);
  for (const directory of workspace.directories) {
    await fs.ensureDir(resolveWorkspaceChild(root, directory));
  }
  for (const file of workspace.files) {
    const target = resolveWorkspaceChild(root, file.path);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, file.content, "utf8");
  }
  const manifest: WorkspaceManifest = {
    version: 1,
    primaryPath: workspace.primaryPath,
  };
  await fs.writeFile(
    path.join(root, ROLE_SKILL_WORKSPACE_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

export async function replaceRoleSkillWorkspace(
  scope: RoleSkillWorkspaceScope,
  value: RoleSkillWorkspace,
) {
  const workspace = normalizeSkillWorkspace(value);
  const target = resolveWorkspaceDirectory(scope);
  const parent = path.dirname(target);
  const token = randomUUID();
  const temporary = path.join(parent, `.${path.basename(target)}.${token}.tmp`);
  const backup = path.join(parent, `.${path.basename(target)}.${token}.bak`);
  await fs.ensureDir(parent);

  let movedExisting = false;
  let preserveBackup = false;
  try {
    await writeWorkspaceDirectory(temporary, workspace);
    if (await fs.pathExists(target)) {
      await fs.move(target, backup, { overwrite: false });
      movedExisting = true;
    }
    await fs.move(temporary, target, { overwrite: false });
    if (movedExisting) await fs.remove(backup).catch(() => undefined);
  } catch (error) {
    await fs.remove(temporary).catch(() => undefined);
    if (movedExisting && !await fs.pathExists(target) && await fs.pathExists(backup)) {
      try {
        await fs.move(backup, target, { overwrite: false });
      } catch {
        preserveBackup = true;
      }
    }
    throw error;
  } finally {
    if (!preserveBackup) await fs.remove(backup).catch(() => undefined);
  }
}

export async function copyRoleSkillWorkspace(
  source: RoleSkillWorkspaceScope,
  target: RoleSkillWorkspaceScope,
  fallbackContent: string,
) {
  const workspace = await readRoleSkillWorkspace(source, fallbackContent);
  await replaceRoleSkillWorkspace(target, workspace);
  return workspace;
}

export async function deleteRoleSkillWorkspace(scope: RoleSkillWorkspaceScope) {
  await fs.remove(resolveWorkspaceDirectory(scope));
}
