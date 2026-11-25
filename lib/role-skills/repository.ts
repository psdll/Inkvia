import prisma from "@/lib/prisma";
import { deleteRoleSkillCoverIfUnreferenced } from "@/lib/role-skills/cover-storage";
import {
  getRoleSkillTextLimits,
  normalizeRoleSkillInput,
  normalizeRoleSkillMediaType,
  normalizeRoleSkillStatus,
  parseRoleSkillPublicId,
  toRoleSkillPublicId,
  type AdminRoleSkillDetail,
  type AdminRoleSkillListItem,
  type PersonalRoleSkillInput,
  type RoleSkillDetail,
  type RoleSkillInput,
  type RoleSkillListItem,
  type RoleSkillSource,
  type RoleSkillStatus,
  type SystemRoleSkillInput,
} from "@/lib/role-skills/contracts";
import {
  deleteRoleSkillWorkspace,
  readRoleSkillWorkspace,
  readRoleSkillWorkspaceDocument,
  replaceRoleSkillWorkspace,
  type RoleSkillWorkspaceScope,
} from "@/lib/role-skills/workspace-storage";

export type RoleSkillRepositoryErrorCode =
  | "invalid"
  | "not-found"
  | "conflict"
  | "unavailable";

export class RoleSkillRepositoryError extends Error {
  constructor(
    public readonly code: RoleSkillRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoleSkillRepositoryError";
  }
}

type SkillRow = {
  id: bigint;
  name: string;
  summary: string;
  category: string;
  coverUrl: string | null;
  content: string;
  usageScenario: string;
  usageGuide: string;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  status?: string;
  mediaType?: string;
  authUser?: { username: string };
};

const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SYSTEM_ROLE_SKILL_RETENTION_DAYS = 30;

export function systemRoleSkillRetentionCutoff(now = new Date()) {
  return new Date(
    now.getTime() - SYSTEM_ROLE_SKILL_RETENTION_DAYS * DAY_MS,
  );
}

function invalid(message: string): never {
  throw new RoleSkillRepositoryError("invalid", message);
}

function notFound(): never {
  throw new RoleSkillRepositoryError("not-found", "技能不存在");
}

function conflict(): never {
  throw new RoleSkillRepositoryError("conflict", "技能已被其他操作修改，请刷新后重试");
}

function unavailable(): never {
  throw new RoleSkillRepositoryError("unavailable", "技能已隐藏或不可用");
}

function parsePublicId(value: string) {
  try {
    return parseRoleSkillPublicId(value);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "技能公开 ID 无效");
  }
}

function expectedRevision(value: number) {
  if (!Number.isInteger(value) || value < 1) invalid("expectedRevision 必须是正整数");
  return value;
}

function normalizeValue(value: RoleSkillInput, existing?: Pick<SkillRow, "name" | "summary">) {
  try {
    return normalizeRoleSkillInput(value, getRoleSkillTextLimits(existing));
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "技能内容无效");
  }
}

function normalizeSystemValue(value: SystemRoleSkillInput, existing?: Pick<SkillRow, "name" | "summary">) {
  const normalized = normalizeValue(value, existing);
  try {
    return {
      ...normalized,
      mediaType: normalizeRoleSkillMediaType(value.mediaType),
    };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "技能类型无效");
  }
}

function normalizePersonalValue(value: PersonalRoleSkillInput, existing?: Pick<SkillRow, "name" | "summary">) {
  const normalized = normalizeValue(value, existing);
  try {
    return {
      ...normalized,
      mediaType: normalizeRoleSkillMediaType(value.mediaType),
    };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "技能类型无效");
  }
}

function assertPersonalCoverOwner(coverUrl: string | null, authUserId: number) {
  if (!coverUrl) return;
  const prefix = `/uploads/role_skill_covers/users/${authUserId}/`;
  if (!coverUrl.startsWith(prefix)) invalid("个人技能封面不属于当前账号");
}

function assertSystemCover(coverUrl: string | null) {
  if (coverUrl && !coverUrl.startsWith("/uploads/role_skill_covers/system/")) {
    invalid("系统技能封面地址无效");
  }
}

function toListItem(source: RoleSkillSource, row: SkillRow): RoleSkillListItem {
  return {
    id: toRoleSkillPublicId(source, row.id),
    source,
    ownerName: source === "system" ? "官方" : row.authUser?.username,
    mediaType: normalizeRoleSkillMediaType(row.mediaType),
    name: row.name,
    summary: row.summary,
    category: row.category,
    coverUrl: row.coverUrl || null,
    usageScenario: row.usageScenario,
    usageGuide: row.usageGuide,
    revision: row.revision,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function toDetail(source: RoleSkillSource, row: SkillRow): RoleSkillDetail {
  return {
    ...toListItem(source, row),
    content: row.content,
    mediaType: normalizeRoleSkillMediaType(row.mediaType),
  };
}

function workspaceScope(
  source: RoleSkillSource,
  row: SkillRow,
  authUserId?: number,
): RoleSkillWorkspaceScope {
  return source === "system"
    ? { source: "system", skillId: row.id }
    : { source: "personal", authUserId: Number(authUserId), skillId: row.id };
}

async function toDetailWithWorkspace(
  source: RoleSkillSource,
  row: SkillRow,
  authUserId?: number,
): Promise<RoleSkillDetail> {
  return {
    ...toDetail(source, row),
    workspace: await readRoleSkillWorkspace(
      workspaceScope(source, row, authUserId),
      row.content,
    ),
  };
}

function toAdminDetail(row: SkillRow): AdminRoleSkillDetail {
  return {
    ...toDetail("system", row),
    mediaType: normalizeRoleSkillMediaType(row.mediaType),
    status: normalizeRoleSkillStatus(row.status),
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
  };
}

function toAdminListItem(row: SkillRow): AdminRoleSkillListItem {
  return {
    ...toListItem("system", row),
    mediaType: normalizeRoleSkillMediaType(row.mediaType),
    status: normalizeRoleSkillStatus(row.status),
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
  };
}

async function toAdminDetailWithWorkspace(row: SkillRow): Promise<AdminRoleSkillDetail> {
  return {
    ...toAdminDetail(row),
    workspace: await readRoleSkillWorkspace(
      { source: "system", skillId: row.id },
      row.content,
    ),
  };
}

function databaseValue<T extends RoleSkillInput>(value: T) {
  const { workspace, ...data } = value;
  return { workspace, data };
}

async function updateSkillWithWorkspace(input: {
  model: "systemRoleSkill" | "userRoleSkill";
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  scope: RoleSkillWorkspaceScope;
  previousContent: string;
  workspace: NonNullable<RoleSkillInput["workspace"]>;
}): Promise<SkillRow | null> {
  const previousWorkspace = await readRoleSkillWorkspace(
    input.scope,
    input.previousContent,
  );
  let workspaceReplaced = false;
  try {
    return await db.$transaction(async (transaction: any) => {
      const [updated] = await transaction[input.model].updateManyAndReturn({
        where: input.where,
        data: input.data,
      });
      if (!updated) return null;
      await replaceRoleSkillWorkspace(input.scope, input.workspace);
      workspaceReplaced = true;
      return updated;
    });
  } catch (error) {
    if (workspaceReplaced) {
      try {
        await replaceRoleSkillWorkspace(input.scope, previousWorkspace);
      } catch (restoreError) {
        console.error("[role-skill] failed to restore workspace after database rollback", {
          error,
          restoreError,
          scope: input.scope,
        });
      }
    }
    throw error;
  }
}

function compareSkills(left: RoleSkillListItem, right: RoleSkillListItem) {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.id.localeCompare(right.id);
}

export async function listRoleSkillsForUser(input: {
  authUserId: number;
}): Promise<RoleSkillListItem[]> {
  const [systems, personals] = await Promise.all([
    db.systemRoleSkill.findMany({
      where: { status: "published", deletedAt: null },
    }),
    db.userRoleSkill.findMany({
      where: { authUserId: input.authUserId, deletedAt: null },
      include: { authUser: { select: { username: true } } },
    }),
  ]);
  return [
    ...systems.map((row: SkillRow) => toListItem("system", row)),
    ...personals.map((row: SkillRow) => toListItem("personal", row)),
  ].sort(compareSkills);
}

export async function listRoleSkillsForAdminAudit(input: {
  authUserId: number | null;
}): Promise<RoleSkillDetail[]> {
  const [systems, personals] = await Promise.all([
    db.systemRoleSkill.findMany({
      where: { status: "published", deletedAt: null },
    }),
    input.authUserId === null
      ? Promise.resolve([])
      : db.userRoleSkill.findMany({
          where: { authUserId: input.authUserId, deletedAt: null },
          include: { authUser: { select: { username: true } } },
        }),
  ]);
  const details = await Promise.all([
    ...systems.map((row: SkillRow) => toDetailWithWorkspace("system", row)),
    ...personals.map((row: SkillRow) => toDetailWithWorkspace("personal", row, Number(input.authUserId))),
  ]);
  return details.sort(compareSkills);
}

export async function getPersonalRoleSkill(input: {
  authUserId: number;
  publicId: string;
}): Promise<RoleSkillDetail> {
  const parsed = parsePublicId(input.publicId);
  if (parsed.source !== "personal") notFound();
  const row = await db.userRoleSkill.findFirst({
    where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null },
    include: { authUser: { select: { username: true } } },
  });
  if (!row) notFound();
  return toDetailWithWorkspace("personal", row, input.authUserId);
}

export async function getSystemRoleSkillForUser(
  publicId: string,
): Promise<RoleSkillDetail> {
  const parsed = parsePublicId(publicId);
  if (parsed.source !== "system") notFound();
  const row = await db.systemRoleSkill.findFirst({
    where: { id: parsed.id, status: "published", deletedAt: null },
  });
  if (!row) unavailable();
  return toDetailWithWorkspace("system", row);
}

export async function assertRoleSkillRevision(input: { authUserId: number; publicId: string; revision: number }) {
  const parsed = parsePublicId(input.publicId);
  const row = parsed.source === "system"
    ? await db.systemRoleSkill.findFirst({ where: { id: parsed.id, status: "published", deletedAt: null }, select: { revision: true } })
    : await db.userRoleSkill.findFirst({ where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null }, select: { revision: true } });
  if (!row) unavailable();
  if (row.revision !== input.revision) conflict();
}

/** Agent document reads do not materialize every workspace body. Recheck after I/O too. */
export async function readRoleSkillDocument(input: { authUserId: number; publicId: string; path?: string; revision?: number }) {
  const parsed = parsePublicId(input.publicId);
  const read = () => parsed.source === "system"
    ? db.systemRoleSkill.findFirst({ where: { id: parsed.id, status: "published", deletedAt: null } })
    : db.userRoleSkill.findFirst({ where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null } });
  const row: SkillRow | null = await read();
  if (!row) unavailable();
  if (input.revision !== undefined && input.revision !== row.revision) conflict();
  const document = await readRoleSkillWorkspaceDocument(workspaceScope(parsed.source, row, input.authUserId), row.content, input.path);
  if (input.path && document.path !== document.primaryPath && input.revision === undefined) conflict();
  const fresh = await read();
  if (!fresh) unavailable();
  if (fresh.revision !== row.revision) conflict();
  return { id: input.publicId, name: row.name, source: parsed.source, revision: row.revision, ...document };
}

export async function createPersonalRoleSkill(input: {
  authUserId: number;
  value: PersonalRoleSkillInput;
}): Promise<RoleSkillDetail> {
  const value = normalizePersonalValue(input.value);
  assertPersonalCoverOwner(value.coverUrl, input.authUserId);
  const { workspace, data } = databaseValue(value);
  const row = await db.userRoleSkill.create({
    data: { authUserId: input.authUserId, ...data },
    include: { authUser: { select: { username: true } } },
  });
  try {
    await replaceRoleSkillWorkspace(
      { source: "personal", authUserId: input.authUserId, skillId: row.id },
      workspace!,
    );
  } catch (error) {
    await db.userRoleSkill.delete({ where: { id: row.id } }).catch(() => undefined);
    throw error;
  }
  return toDetailWithWorkspace("personal", row, input.authUserId);
}

export async function updatePersonalRoleSkill(input: {
  authUserId: number;
  publicId: string;
  expectedRevision: number;
  value: PersonalRoleSkillInput;
}): Promise<RoleSkillDetail> {
  const parsed = parsePublicId(input.publicId);
  if (parsed.source !== "personal") notFound();
  const revision = expectedRevision(input.expectedRevision);
  const existing = await db.userRoleSkill.findFirst({
    where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null },
    include: { authUser: { select: { username: true } } },
  });
  if (!existing) notFound();
  if (existing.revision !== revision) conflict();
  const value = normalizePersonalValue(input.value, existing);
  assertPersonalCoverOwner(value.coverUrl, input.authUserId);
  const { workspace, data } = databaseValue(value);
  const updated = await updateSkillWithWorkspace({
    model: "userRoleSkill",
    where: {
      id: parsed.id,
      authUserId: input.authUserId,
      deletedAt: null,
      revision,
    },
    data: { ...data, revision: { increment: 1 } },
    scope: { source: "personal", authUserId: input.authUserId, skillId: parsed.id },
    previousContent: existing.content,
    workspace: workspace!,
  });
  if (updated) {
    return toDetailWithWorkspace("personal", { ...updated, authUser: existing.authUser }, input.authUserId);
  }
  const current = await db.userRoleSkill.findFirst({
    where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null },
    select: { id: true },
  });
  if (!current) notFound();
  return conflict();
}

export async function deletePersonalRoleSkill(input: {
  authUserId: number;
  publicId: string;
  expectedRevision: number;
}): Promise<{ coverUrl: string | null }> {
  const parsed = parsePublicId(input.publicId);
  if (parsed.source !== "personal") notFound();
  const revision = expectedRevision(input.expectedRevision);
  const existing = await db.userRoleSkill.findFirst({
    where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null },
  });
  if (!existing) notFound();
  const deleted = await db.userRoleSkill.deleteMany({
    where: {
      id: parsed.id,
      authUserId: input.authUserId,
      deletedAt: null,
      revision,
    },
  });
  if (!deleted.count) {
    const current = await db.userRoleSkill.findFirst({
      where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null },
      select: { id: true },
    });
    if (!current) notFound();
    conflict();
  }
  await deleteRoleSkillWorkspace({
    source: "personal",
    authUserId: input.authUserId,
    skillId: parsed.id,
  }).catch((error) => {
    console.warn("[role-skill] failed to delete personal workspace", error);
  });
  return { coverUrl: existing.coverUrl || null };
}

export async function listSystemRoleSkillsForAdmin(input: {
  includeDeleted?: boolean;
} = {}): Promise<AdminRoleSkillListItem[]> {
  const rows = await db.systemRoleSkill.findMany({
    where: input.includeDeleted ? {} : { deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  return rows.map((row: SkillRow) => toAdminListItem(row));
}

export async function purgeExpiredSystemRoleSkills(input: {
  now?: Date;
  limit?: number;
} = {}) {
  const cutoff = systemRoleSkillRetentionCutoff(input.now);
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 20), 1), 100);
  const expired = await db.systemRoleSkill.findMany({
    where: { deletedAt: { lte: cutoff } },
    orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, coverUrl: true },
  });
  if (!expired.length) return { deletedSkills: 0, deletedCovers: 0 };

  const deleted = await db.systemRoleSkill.deleteMany({
    where: {
      id: { in: expired.map((skill: { id: bigint }) => skill.id) },
      deletedAt: { lte: cutoff },
    },
  });
  let deletedCovers = 0;
  const coverUrls = Array.from(new Set(
    expired
      .map((skill: { coverUrl: string | null }) => skill.coverUrl)
      .filter((coverUrl: string | null): coverUrl is string => Boolean(coverUrl)),
  ));
  for (const coverUrl of coverUrls) {
    try {
      const result = await deleteRoleSkillCoverIfUnreferenced(coverUrl);
      if (result.deleted) deletedCovers += 1;
    } catch (error) {
      console.warn("[role-skill] failed to purge expired system cover", error);
    }
  }
  for (const skill of expired) {
    await deleteRoleSkillWorkspace({
      source: "system",
      skillId: skill.id,
    }).catch((error) => {
      console.warn("[role-skill] failed to purge expired system workspace", error);
    });
  }
  return { deletedSkills: Number(deleted.count || 0), deletedCovers };
}

export async function getSystemRoleSkillForAdmin(publicId: string) {
  const parsed = parsePublicId(publicId);
  if (parsed.source !== "system") notFound();
  const row = await db.systemRoleSkill.findFirst({ where: { id: parsed.id } });
  if (!row) notFound();
  return toAdminDetailWithWorkspace(row);
}

export async function createSystemRoleSkill(input: {
  value: SystemRoleSkillInput;
  status: RoleSkillStatus;
}) {
  const value = normalizeSystemValue(input.value);
  assertSystemCover(value.coverUrl);
  let status: RoleSkillStatus;
  try {
    status = normalizeRoleSkillStatus(input.status);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "技能状态无效");
  }
  const { workspace, data } = databaseValue(value);
  const row = await db.systemRoleSkill.create({ data: { ...data, status } });
  try {
    await replaceRoleSkillWorkspace(
      { source: "system", skillId: row.id },
      workspace!,
    );
  } catch (error) {
    await db.systemRoleSkill.delete({ where: { id: row.id } }).catch(() => undefined);
    throw error;
  }
  return toAdminDetailWithWorkspace(row);
}

export async function updateSystemRoleSkill(input: {
  publicId: string;
  expectedRevision: number;
  value: SystemRoleSkillInput;
  status: RoleSkillStatus;
}) {
  const parsed = parsePublicId(input.publicId);
  if (parsed.source !== "system") notFound();
  const revision = expectedRevision(input.expectedRevision);
  let status: RoleSkillStatus;
  try {
    status = normalizeRoleSkillStatus(input.status);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "技能状态无效");
  }
  const existing = await db.systemRoleSkill.findFirst({
    where: { id: parsed.id, deletedAt: null },
  });
  if (!existing) notFound();
  if (existing.revision !== revision) conflict();
  const value = normalizeSystemValue(input.value, existing);
  assertSystemCover(value.coverUrl);
  const { workspace, data } = databaseValue(value);
  const updated = await updateSkillWithWorkspace({
    model: "systemRoleSkill",
    where: { id: parsed.id, deletedAt: null, revision },
    data: { ...data, status, revision: { increment: 1 } },
    scope: { source: "system", skillId: parsed.id },
    previousContent: existing.content,
    workspace: workspace!,
  });
  if (updated) {
    return toAdminDetailWithWorkspace(updated);
  }
  const current = await db.systemRoleSkill.findFirst({
    where: { id: parsed.id, deletedAt: null },
    select: { id: true },
  });
  if (!current) notFound();
  return conflict();
}

export async function deleteSystemRoleSkill(input: {
  publicId: string;
  expectedRevision: number;
}) {
  const parsed = parsePublicId(input.publicId);
  if (parsed.source !== "system") notFound();
  const revision = expectedRevision(input.expectedRevision);
  const [deleted] = await db.systemRoleSkill.updateManyAndReturn({
    where: { id: parsed.id, deletedAt: null, revision },
    data: { deletedAt: new Date(), status: "hidden", revision: { increment: 1 } },
  });
  if (deleted) return toAdminDetailWithWorkspace(deleted);
  const existing = await db.systemRoleSkill.findFirst({ where: { id: parsed.id, deletedAt: null } });
  if (!existing) notFound();
  return conflict();
}

export async function restoreSystemRoleSkill(input: {
  publicId: string;
  expectedRevision: number;
  now?: Date;
}) {
  const parsed = parsePublicId(input.publicId);
  if (parsed.source !== "system") notFound();
  const revision = expectedRevision(input.expectedRevision);
  const cutoff = systemRoleSkillRetentionCutoff(input.now);
  const [restored] = await db.systemRoleSkill.updateManyAndReturn({
    where: { id: parsed.id, deletedAt: { gt: cutoff }, revision },
    data: { deletedAt: null, status: "hidden", revision: { increment: 1 } },
  });
  if (restored) return toAdminDetailWithWorkspace(restored);
  const existing = await db.systemRoleSkill.findFirst({ where: { id: parsed.id } });
  if (!existing) notFound();
  if (existing.deletedAt && new Date(existing.deletedAt) <= cutoff) notFound();
  return conflict();
}

export async function resolveRoleSkillForExecution(input: {
  authUserId: number;
  publicId: string;
}): Promise<{
  source: RoleSkillSource;
  id: bigint;
  name: string;
  revision: number;
  content: string;
}> {
  const parsed = parsePublicId(input.publicId);
  if (parsed.source === "system") {
    const row = await db.systemRoleSkill.findFirst({
      where: { id: parsed.id, status: "published", deletedAt: null },
    });
    if (!row) unavailable();
    return {
      source: "system",
      id: row.id,
      name: row.name,
      revision: row.revision,
      content: row.content,
    };
  }
  const row = await db.userRoleSkill.findFirst({
    where: { id: parsed.id, authUserId: input.authUserId, deletedAt: null },
  });
  if (!row) notFound();
  return {
    source: "personal",
    id: row.id,
    name: row.name,
    revision: row.revision,
    content: row.content,
  };
}
