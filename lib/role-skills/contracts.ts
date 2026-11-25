import {
  getSkillWorkspacePrimaryContent,
  normalizeSkillWorkspace,
} from "@/lib/role-skills/skill-workspace";
import type { RoleSkillFeatureKey } from "@/lib/role-skills/features";

export type RoleSkillSource = "system" | "personal";
export type RoleSkillStatus = "published" | "hidden";
export type RoleSkillMediaType = "image" | "video" | "audio" | "text";

export type RoleSkillWorkspaceFile = {
  path: string;
  content: string;
};

export type RoleSkillWorkspace = {
  files: RoleSkillWorkspaceFile[];
  directories: string[];
  primaryPath: string | null;
};

export type RoleSkillListItem = {
  id: string;
  source: RoleSkillSource;
  ownerName?: string;
  mediaType: RoleSkillMediaType;
  name: string;
  summary: string;
  category: string;
  coverUrl: string | null;
  usageScenario: string;
  usageGuide: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type RoleSkillDetail = RoleSkillListItem & {
  content: string;
  mediaType: RoleSkillMediaType;
  workspace?: RoleSkillWorkspace;
};

export type AdminRoleSkillListItem = RoleSkillListItem & {
  mediaType: RoleSkillMediaType;
  status: RoleSkillStatus;
  deletedAt: string | null;
};

export type AdminRoleSkillDetail = RoleSkillDetail & {
  mediaType: RoleSkillMediaType;
  status: RoleSkillStatus;
  deletedAt: string | null;
  featureKeys?: RoleSkillFeatureKey[];
};

export type RoleSkillInput = {
  name: string;
  summary: string;
  category: string;
  coverUrl: string | null;
  content: string;
  usageScenario: string;
  usageGuide: string;
  workspace?: RoleSkillWorkspace;
};

export type SystemRoleSkillInput = RoleSkillInput & {
  mediaType: RoleSkillMediaType;
};

export type PersonalRoleSkillInput = RoleSkillInput & {
  mediaType?: RoleSkillMediaType;
};

export const ROLE_SKILL_TEXT_LIMITS = { name: 20, summary: 50 };

export function getRoleSkillTextLimits(existing?: Partial<Pick<RoleSkillInput, "name" | "summary">>) {
  return {
    name: Math.max(ROLE_SKILL_TEXT_LIMITS.name, existing?.name?.trim().length || 0),
    summary: Math.max(ROLE_SKILL_TEXT_LIMITS.summary, existing?.summary?.trim().length || 0),
  };
}

const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const ROLE_SKILL_COVER_PREFIX = "/uploads/role_skill_covers/";

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${field}必须是文本`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field}不能为空`);
  if (normalized.length > maxLength) {
    throw new Error(`${field}不能超过 ${maxLength} 个字符`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return "";
  return requiredText(value, field, maxLength);
}

function optionalCoverUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("封面地址必须是文本");
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized.startsWith(ROLE_SKILL_COVER_PREFIX)) {
    throw new Error("封面地址不在受控技能目录中");
  }
  if (normalized.includes("..") || /[?#]/.test(normalized)) {
    throw new Error("封面地址无效");
  }
  return normalized;
}

export function normalizeRoleSkillInput(
  input: RoleSkillInput,
  // Keep archive restoration compatible with the original database limits.
  textLimits = { name: 64, summary: 200 },
): RoleSkillInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("技能内容必须是对象");
  }
  const workspace = normalizeSkillWorkspace(input.workspace, input.content);
  const content = requiredText(
    getSkillWorkspacePrimaryContent(workspace),
    "Skill 内容",
    200_000,
  );
  const normalizedWorkspace = {
    ...workspace,
    files: workspace.files.map((file) =>
      file.path === workspace.primaryPath ? { ...file, content } : file,
    ),
  };
  const normalized = {
    name: requiredText(input.name, "名称", textLimits.name),
    summary: requiredText(input.summary, "一句话介绍", textLimits.summary),
    category: requiredText(input.category, "分类", 64),
    coverUrl: optionalCoverUrl(input.coverUrl),
    content,
    usageScenario: optionalText(input.usageScenario, "适用场景", 200_000),
    usageGuide: optionalText(input.usageGuide, "如何使用", 200_000),
    workspace: normalizedWorkspace,
  };
  if (normalized.category.toLowerCase() === "all") {
    throw new Error("分类不能使用保留值 all");
  }
  return normalized;
}

export function normalizeRoleSkillMediaType(value: unknown): RoleSkillMediaType {
  if (value === null || value === undefined || value === "") return "image";
  if (value === "image" || value === "video" || value === "audio" || value === "text") {
    return value;
  }
  throw new Error("技能类型无效");
}

function assertSource(value: unknown): asserts value is RoleSkillSource {
  if (value !== "system" && value !== "personal") {
    throw new Error("技能来源无效");
  }
}

function assertId(value: bigint) {
  if (value <= BigInt(0) || value > MAX_POSTGRES_BIGINT) {
    throw new Error("技能 ID 无效");
  }
}

export function toRoleSkillPublicId(source: RoleSkillSource, id: bigint) {
  assertSource(source);
  assertId(id);
  return `${source}:${id}`;
}

export function parseRoleSkillPublicId(value: string): {
  source: RoleSkillSource;
  id: bigint;
} {
  const match = /^(system|personal):([1-9]\d*)$/.exec(String(value || ""));
  if (!match) throw new Error("技能公开 ID 无效");
  const source = match[1];
  const id = BigInt(match[2]);
  assertSource(source);
  assertId(id);
  return { source, id };
}

export function normalizeRoleSkillStatus(value: unknown): RoleSkillStatus {
  if (value !== "published" && value !== "hidden") {
    throw new Error("技能状态无效");
  }
  return value;
}
