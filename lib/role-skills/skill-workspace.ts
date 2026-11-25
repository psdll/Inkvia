import type {
  RoleSkillWorkspace,
  RoleSkillWorkspaceFile,
} from "@/lib/role-skills/contracts";

export type SkillWorkspaceFileLike = {
  name: string;
  webkitRelativePath?: string;
};

export const ROLE_SKILL_WORKSPACE_MANIFEST = ".role-skill-workspace.json";
export const MAX_ROLE_SKILL_WORKSPACE_FILES = 100;
export const MAX_ROLE_SKILL_WORKSPACE_DIRECTORIES = 100;
export const MAX_ROLE_SKILL_WORKSPACE_FILE_CHARS = 200_000;
export const MAX_ROLE_SKILL_WORKSPACE_TOTAL_CHARS = 1_000_000;
export const MAX_ROLE_SKILL_WORKSPACE_PATH_LENGTH = 240;
export const MAX_ROLE_SKILL_WORKSPACE_DEPTH = 12;

function comparePaths(left: string, right: string) {
  return left.localeCompare(right, "zh-CN");
}

export function normalizeSkillWorkspacePath(value: unknown) {
  if (typeof value !== "string") throw new Error("技能工作区路径必须是文本");
  const raw = value.trim().replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || /^[a-z]:/i.test(raw)) {
    throw new Error("技能工作区路径无效");
  }
  if (raw.length > MAX_ROLE_SKILL_WORKSPACE_PATH_LENGTH) {
    throw new Error(`技能工作区路径不能超过 ${MAX_ROLE_SKILL_WORKSPACE_PATH_LENGTH} 个字符`);
  }
  const parts = raw.split("/");
  if (parts.length > MAX_ROLE_SKILL_WORKSPACE_DEPTH) {
    throw new Error(`技能工作区目录不能超过 ${MAX_ROLE_SKILL_WORKSPACE_DEPTH} 层`);
  }
  for (const part of parts) {
    if (
      !part
      || part === "."
      || part === ".."
      || part === ROLE_SKILL_WORKSPACE_MANIFEST
      || /[<>:"|?*\u0000-\u001f]/.test(part)
      || /[. ]$/.test(part)
    ) {
      throw new Error(`技能工作区路径无效：${raw}`);
    }
  }
  return parts.join("/");
}

export function joinSkillWorkspacePath(parentPath: string, name: string) {
  const parent = parentPath ? normalizeSkillWorkspacePath(parentPath) : "";
  const child = normalizeSkillWorkspacePath(name);
  if (child.includes("/")) throw new Error("名称中不能包含路径分隔符");
  return normalizeSkillWorkspacePath(parent ? `${parent}/${child}` : child);
}

export function getSkillWorkspaceParentPath(path: string) {
  const normalized = normalizeSkillWorkspacePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

export function getSkillWorkspaceBaseName(path: string) {
  const normalized = normalizeSkillWorkspacePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function parentDirectories(path: string) {
  const parts = path.split("/");
  const parents: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join("/"));
  }
  return parents;
}

export function createDefaultSkillWorkspace(content = ""): RoleSkillWorkspace {
  return {
    files: [{ path: "SKILL.md", content: String(content || "") }],
    directories: [],
    primaryPath: "SKILL.md",
  };
}

export function normalizeSkillWorkspace(
  value: unknown,
  fallbackContent = "",
): RoleSkillWorkspace {
  if (value === undefined || value === null) {
    return createDefaultSkillWorkspace(fallbackContent);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("技能工作区必须是对象");
  }

  const raw = value as Partial<RoleSkillWorkspace>;
  if (!Array.isArray(raw.files) || !Array.isArray(raw.directories)) {
    throw new Error("技能工作区文件与目录格式无效");
  }
  if (raw.files.length > MAX_ROLE_SKILL_WORKSPACE_FILES) {
    throw new Error(`技能工作区最多包含 ${MAX_ROLE_SKILL_WORKSPACE_FILES} 个文件`);
  }
  if (raw.directories.length > MAX_ROLE_SKILL_WORKSPACE_DIRECTORIES) {
    throw new Error(`技能工作区最多包含 ${MAX_ROLE_SKILL_WORKSPACE_DIRECTORIES} 个目录`);
  }

  let totalChars = 0;
  const fileMap = new Map<string, RoleSkillWorkspaceFile>();
  for (const item of raw.files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("技能工作区文件格式无效");
    }
    const path = normalizeSkillWorkspacePath((item as RoleSkillWorkspaceFile).path);
    const content = (item as RoleSkillWorkspaceFile).content;
    if (typeof content !== "string") throw new Error(`文件 ${path} 的内容必须是文本`);
    if (content.length > MAX_ROLE_SKILL_WORKSPACE_FILE_CHARS) {
      throw new Error(`文件 ${path} 不能超过 ${MAX_ROLE_SKILL_WORKSPACE_FILE_CHARS} 个字符`);
    }
    if (fileMap.has(path)) throw new Error(`工作区存在同名文件：${path}`);
    totalChars += content.length;
    if (totalChars > MAX_ROLE_SKILL_WORKSPACE_TOTAL_CHARS) {
      throw new Error(`技能工作区总内容不能超过 ${MAX_ROLE_SKILL_WORKSPACE_TOTAL_CHARS} 个字符`);
    }
    fileMap.set(path, { path, content });
  }
  if (fileMap.size === 0) throw new Error("技能工作区至少需要一个文件");

  const directorySet = new Set<string>();
  for (const value of raw.directories) {
    directorySet.add(normalizeSkillWorkspacePath(value));
  }
  for (const file of fileMap.values()) {
    for (const parent of parentDirectories(file.path)) directorySet.add(parent);
  }
  for (const directory of Array.from(directorySet)) {
    if (fileMap.has(directory)) throw new Error(`文件与目录路径冲突：${directory}`);
    for (const parent of parentDirectories(directory)) directorySet.add(parent);
  }
  for (const filePath of fileMap.keys()) {
    const prefix = `${filePath}/`;
    if (Array.from(fileMap.keys()).some((other) => other.startsWith(prefix))) {
      throw new Error(`文件不能作为其他文件的父目录：${filePath}`);
    }
  }
  if (directorySet.size > MAX_ROLE_SKILL_WORKSPACE_DIRECTORIES) {
    throw new Error(`技能工作区最多包含 ${MAX_ROLE_SKILL_WORKSPACE_DIRECTORIES} 个目录`);
  }

  const files = Array.from(fileMap.values()).sort((left, right) => comparePaths(left.path, right.path));
  const requestedPrimary = raw.primaryPath === null || raw.primaryPath === undefined
    ? ""
    : normalizeSkillWorkspacePath(raw.primaryPath);
  const primaryPath = fileMap.has(requestedPrimary) ? requestedPrimary : files[0].path;
  return {
    files,
    directories: Array.from(directorySet).sort(comparePaths),
    primaryPath,
  };
}

export function getSkillWorkspacePrimaryContent(workspace: RoleSkillWorkspace) {
  const normalized = normalizeSkillWorkspace(workspace);
  return normalized.files.find((file) => file.path === normalized.primaryPath)?.content || "";
}

export function isMarkdownFileName(name: string) {
  return /\.md$/i.test(String(name || "").trim());
}

function relativeDepth(file: SkillWorkspaceFileLike) {
  const path = file.webkitRelativePath || file.name;
  return path.split(/[\\/]/).filter(Boolean).length;
}

export function pickSkillMarkdownFile<T extends SkillWorkspaceFileLike>(files: T[]): T | null {
  return files
    .filter((file) => file.name.toLowerCase() === "skill.md")
    .sort((left, right) => relativeDepth(left) - relativeDepth(right))[0] || null;
}
