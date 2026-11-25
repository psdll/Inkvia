import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  parseRolePositioningSurface,
} from "@/lib/role-positioning-surface";
import {
  parseRolePositioningContinuation,
  safeRolePositioningContinuation,
} from "@/lib/role-positioning-continuation";
import {
  parseRoleSkillPublicId,
  toRoleSkillPublicId,
} from "@/lib/role-skills/contracts";
import { getCurrentUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_LENGTH = 200_000;

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

function draftModel() {
  const model = (prisma as any).rolePositioningDraft;
  if (!model?.findUnique || !model?.upsert) {
    throw new Error("角色定位账号草稿表未初始化，请先执行数据库迁移");
  }
  return model;
}

function serializeDraft(draft: any) {
  if (!draft) return null;
  return {
    surface: draft.surface,
    systemPrompt: String(draft.systemPrompt || ""),
    reversePrompt: String(draft.reversePrompt || ""),
    reversePromptApplied: draft.reversePromptApplied === true,
    activeReverseTaskId:
      Number.isInteger(draft.activeReverseTaskId) && draft.activeReverseTaskId > 0
        ? draft.activeReverseTaskId
        : null,
    continuation: safeRolePositioningContinuation(
      draft.continuation,
      draft.surface,
    ),
    selectedRoleSkillId: serializeSkillId(
      draft.selectedSkillSource,
      draft.selectedSkillId,
    ),
    resultRoleSkill: serializeResultSkill(draft),
    updatedAt: draft.updatedAt,
  };
}

function serializeSkillId(source: unknown, id: unknown) {
  if (source !== "system" && source !== "personal") return null;
  try {
    return toRoleSkillPublicId(source, BigInt(String(id)));
  } catch {
    return null;
  }
}

function serializeResultSkill(draft: any) {
  const id = serializeSkillId(draft.resultSkillSource, draft.resultSkillId);
  const name = String(draft.resultSkillName || "").trim();
  const revision = Number(draft.resultSkillRevision);
  if (!id || !name || !Number.isInteger(revision) || revision < 1) return null;
  return { id, name, revision };
}

function parseOptionalSkillId(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return { source: null, id: null };
  }
  const parsed = parseRoleSkillPublicId(String(value));
  return { source: parsed.source, id: parsed.id };
}

function parseResultSkill(value: unknown) {
  if (value === null || value === undefined) {
    return { source: null, id: null, name: null, revision: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("结果技能格式无效");
  }
  const result = value as Record<string, unknown>;
  const parsed = parseRoleSkillPublicId(String(result.id || ""));
  const name = String(result.name || "").trim();
  const revision = Number(result.revision);
  if (!name || name.length > 64 || !Number.isInteger(revision) || revision < 1) {
    throw new Error("结果技能格式无效");
  }
  return { source: parsed.source, id: parsed.id, name, revision };
}

function promptValue(value: unknown) {
  return String(value || "").slice(0, MAX_PROMPT_LENGTH);
}

function activeTaskIdValue(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) {
    return json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
  }

  const surface = parseRolePositioningSurface(
    new URL(req.url).searchParams.get("surface"),
  );
  if (!surface) {
    return json({ success: false, error: apiMessage("m0db5dbf5d5c3") }, { status: 400 });
  }

  const draft = await draftModel().findUnique({
    where: {
      authUserId_surface: {
        authUserId: currentUser.id,
        surface,
      },
    },
  });
  return json({ success: true, draft: serializeDraft(draft) });
}

export async function PUT(req: NextRequest) {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) {
    return json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
  }

  const surface = parseRolePositioningSurface(
    new URL(req.url).searchParams.get("surface"),
  );
  if (!surface) {
    return json({ success: false, error: apiMessage("m0db5dbf5d5c3") }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  let selectedSkill;
  let resultSkill;
  let continuation;
  try {
    selectedSkill = parseOptionalSkillId(body?.selectedRoleSkillId);
    resultSkill = parseResultSkill(body?.resultRoleSkill);
    continuation = parseRolePositioningContinuation(body?.continuation, surface);
  } catch (error) {
    return json({
      success: false,
      error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("m8240a41f522f")),
    }, { status: 400 });
  }
  const values = {
    systemPrompt: promptValue(body?.systemPrompt),
    reversePrompt: promptValue(body?.reversePrompt),
    reversePromptApplied: body?.reversePromptApplied === true,
    activeReverseTaskId: activeTaskIdValue(body?.activeReverseTaskId),
    continuation: continuation ?? Prisma.DbNull,
    selectedSkillSource: selectedSkill.source,
    selectedSkillId: selectedSkill.id,
    resultSkillSource: resultSkill.source,
    resultSkillId: resultSkill.id,
    resultSkillName: resultSkill.name,
    resultSkillRevision: resultSkill.revision,
  };
  const draft = await draftModel().upsert({
    where: {
      authUserId_surface: {
        authUserId: currentUser.id,
        surface,
      },
    },
    create: {
      authUserId: currentUser.id,
      surface,
      ...values,
    },
    update: values,
  });
  return json({ success: true, draft: serializeDraft(draft) });
}
