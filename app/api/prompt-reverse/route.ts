import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { resolvePromptReverseMediaUrl } from "@/lib/prompt-reverse-media-url";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/server-auth";
import { Logger } from "@/lib/logger";
import { normalizeMediaUrl } from "@/lib/media-url";
import {
  buildPromptReverseMessages,
} from "@/lib/prompt-reverse";
import { callLlmForScenario, getPublicLlmError } from "@/lib/llm-routing/gateway";
import {
  attachLlmEgressDecision,
  resolveLlmRoute,
  resolveLlmRouteFromProviders,
} from "@/lib/llm-routing/resolver";
import type { ResolvedLlmRoute } from "@/lib/llm-routing/types";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { readProxySettingRaw, resolveProviderProxyFromRaw } from "@/lib/providers/proxy-config";
import prisma from "@/lib/prisma";
import {
  resolveRoleSkillForExecution,
  RoleSkillRepositoryError,
} from "@/lib/role-skills/repository";
import { parseRolePositioningSurface } from "@/lib/role-positioning-surface";
import { resolveSegmentedPromptSystemPrompt } from "@/lib/image-batch/segmented-prompt-rule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

function apiError(message: string, statusCode: number) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

async function resolveRequestedRoleSkill(input: {
  authUserId: number;
  publicId: string;
}) {
  try {
    return await resolveRoleSkillForExecution(input);
  } catch (error) {
    if (error instanceof RoleSkillRepositoryError) {
      const status = {
        invalid: 400,
        "not-found": 404,
        conflict: 409,
        unavailable: 409,
      }[error.code];
      throw apiError(error.message, status);
    }
    throw error;
  }
}

function publicPromptReverseError(error: any, fallback = "生成专业提示词失败") {
  return Number(error?.statusCode) ? String(error?.message || fallback) : getPublicLlmError(error);
}

function promptReverseTaskModel() {
  const model = (prisma as any).promptReverseTask;
  if (!model?.create || !model?.findMany || !model?.update) {
    throw new Error("角色提示词任务表未初始化，请先执行数据库迁移并重启服务");
  }
  return model;
}

function stringArrayFromJson(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    } catch {}
  }
  return [];
}

function serializePromptReverseTask(task: any) {
  const skillId = task.skillSource && task.skillId
    ? `${task.skillSource}:${String(task.skillId)}`
    : "";
  return {
    id: task.id,
    status: task.status,
    surface: task.surface || "toolbox_image",
    userPrompt: task.userPrompt || "",
    requestedModel: task.requestedModel || "",
    llmProviderId: task.llmProviderId || "",
    model: task.model || "",
    mediaUrls: stringArrayFromJson(task.mediaUrls),
    resolvedMediaUrls: stringArrayFromJson(task.resolvedMediaUrls),
    generatedPrompt: task.generatedPrompt || "",
    errorMsg: task.errorMsg || "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    skill: skillId
      ? {
          id: skillId,
          name: task.skillName || "",
          revision: Number(task.skillRevision) || 0,
        }
      : null,
  };
}

async function buildReverseMediaUrls(
  raw: unknown,
  origin: string,
  providerId?: string,
  modelId?: string,
) {
  if (!Array.isArray(raw)) return [] as string[];
  const urls = Array.from(new Set(raw.map((item) => normalizeMediaUrl(item)).filter(Boolean))).slice(0, 16);
  const resolved: string[] = [];
  for (const mediaUrl of urls) {
    const external = await resolvePromptReverseMediaUrl(mediaUrl, origin, providerId, modelId);
    if (/^https?:\/\//i.test(external) || /^data:image\//i.test(external)) resolved.push(external);
  }
  return Array.from(new Set(resolved));
}

async function generatePromptReverse(input: {
  route: ResolvedLlmRoute;
  systemPrompt: string;
  userPrompt: string;
  rawMediaUrls: string[];
  origin: string;
  logUserId: string;
  startAt: number;
}) {
  let mediaUrls: string[] = [];
  try {
    mediaUrls = await buildReverseMediaUrls(input.rawMediaUrls, input.origin, input.route.providerId, input.route.modelId);
  } catch (e: any) {
    throw apiError(String(e?.message || "上传素材链接不可用"), 400);
  }

  const messages = buildPromptReverseMessages({
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    mediaUrls,
  });
  const gatewayResult = await callLlmForScenario(input.route, messages, { billingIdentity: { userId: input.logUserId } });
  const generatedPrompt = String(gatewayResult.text || "").trim();
  if (!generatedPrompt) throw apiError("LLM 返回空提示词，请重试", 502);

  if (input.logUserId) {
    await Logger.log({
      userId: input.logUserId,
      category: "api",
      action: "prompt_reverse",
      level: "success",
      message: "系统提示词反推成功",
      metadata: {
        llmProviderId: input.route.providerId,
        model: input.route.modelId,
        mediaCount: mediaUrls.length,
        systemPromptLength: input.systemPrompt.length,
        userPromptLength: input.userPrompt.length,
        generatedLength: generatedPrompt.length,
      },
      duration: Date.now() - input.startAt,
    });
  }

  return {
    generatedPrompt,
    llmProviderId: input.route.providerId,
    model: input.route.modelId,
    mediaUrls,
    rawResponse: gatewayResult,
  };
}

async function resolveStoredPromptReverseRoute(task: any): Promise<ResolvedLlmRoute> {
  return prisma.$transaction(async (client) => {
  const providers = await getRegisteredProviders(client);
  const rawProxy = providers.some((provider) => provider.egressMode === "proxy")
    ? await readProxySettingRaw(client)
    : null;
  const proxyStatusByProviderId = Object.fromEntries(providers
    .filter((provider) => provider.egressMode === "proxy")
    .map((provider) => [provider.id, resolveProviderProxyFromRaw(provider.id, rawProxy).status]));
  const binding = task.llmProviderId && task.model
    ? { providerId: String(task.llmProviderId), modelId: String(task.model) }
    : null;

  const resolved = resolveLlmRouteFromProviders({
    scenarioId: "image.role_prompt",
    binding,
    providers,
    proxyStatusByProviderId,
  });
  if (resolved.status !== "ready") {
    throw apiError(`角色定位 LLM 路由不可用：${resolved.status}`, 500);
  }
  return attachLlmEgressDecision(resolved.route, providers, rawProxy);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function runPromptReverseTask(taskId: number, origin: string) {
  const startAt = Date.now();
  const model = promptReverseTaskModel();
  const task = await model.findUnique({ where: { id: taskId } });
  if (!task || task.deletedAt) return;

  await model.update({
    where: { id: taskId },
    data: { status: "running", startedAt: new Date(), errorMsg: null },
  });

  try {
    const route = await resolveStoredPromptReverseRoute(task);
    const result = await generatePromptReverse({
      route,
      systemPrompt: task.systemPrompt,
      userPrompt: task.userPrompt,
      rawMediaUrls: stringArrayFromJson(task.mediaUrls),
      origin,
      logUserId: task.userId || "",
      startAt,
    });
    await model.update({
      where: { id: taskId },
      data: {
        status: "success",
        llmProviderId: result.llmProviderId,
        model: result.model,
        resolvedMediaUrls: result.mediaUrls,
        generatedPrompt: result.generatedPrompt,
        rawResponse: result.rawResponse,
        errorMsg: null,
        finishedAt: new Date(),
      },
    });
  } catch (e: any) {
    const message = publicPromptReverseError(e);
    await model.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMsg: message,
        finishedAt: new Date(),
      },
    });
    if (task.userId) {
      await Logger.log({
        userId: task.userId,
        category: "api",
        action: "prompt_reverse",
        level: "error",
        message,
        duration: Date.now() - startAt,
      });
    }
  }
}

export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) return json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const surface = parseRolePositioningSurface(
    searchParams.get("surface"),
    "toolbox_image",
  );
  if (!surface) {
    return json({ success: false, error: apiMessage("m0db5dbf5d5c3") }, { status: 400 });
  }
  const id = Number.parseInt(String(searchParams.get("id") || ""), 10);
  const model = promptReverseTaskModel();
  if (Number.isFinite(id) && id > 0) {
    const task = await model.findFirst({
      where: { id, authUserId: currentUser.id, surface, deletedAt: null },
    });
    if (!task) return json({ success: false, error: apiMessage("m05a616276057") }, { status: 404 });
    return json({ success: true, task: serializePromptReverseTask(task) });
  }

  const limit = Math.min(100, Math.max(1, Number.parseInt(String(searchParams.get("limit") || "50"), 10) || 50));
  const tasks = await model.findMany({
    where: { authUserId: currentUser.id, surface, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return json({ success: true, tasks: tasks.map(serializePromptReverseTask) });
}

export async function POST(req: NextRequest) {
  const startAt = Date.now();
  const currentUser = await getCurrentUser(req);
  const logUserId = currentUser ? String(currentUser.id) : "";

  try {
    const body = await req.json().catch(() => null);
    const surface = parseRolePositioningSurface(
      body?.surface,
      "toolbox_image",
    );
    if (!surface) {
      return json({ success: false, error: apiMessage("m0db5dbf5d5c3") }, { status: 400 });
    }
    const roleSkillId = String(body?.roleSkillId || "").trim();
    if (roleSkillId && !currentUser) {
      return json({ success: false, error: apiMessage("m495c9817fb56") }, { status: 401 });
    }
    const resolvedSkill = roleSkillId
      ? await resolveRequestedRoleSkill({
          authUserId: currentUser!.id,
          publicId: roleSkillId,
        })
      : null;
    const baseSystemPrompt = resolvedSkill?.content
      ?? String(body?.systemPrompt || "").trim();
    const userPrompt = String(body?.userPrompt || "").trim();
    const normalizedMediaUrls = Array.isArray(body?.mediaUrls)
      ? body.mediaUrls
          .map((item: unknown) => normalizeMediaUrl(item))
          .filter((item: string): item is string => Boolean(item))
      : [];
    const rawMediaUrls: string[] = Array.from(new Set<string>(normalizedMediaUrls)).slice(0, 16);

    if (!baseSystemPrompt) {
      return json({ success: false, error: apiMessage("md986fbf42c76") }, { status: 400 });
    }
    const systemPrompt = await resolveSegmentedPromptSystemPrompt({
      surface,
      systemPrompt: baseSystemPrompt,
    });

    if (body?.async === true) {
      if (!currentUser) return json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
      const resolved = await resolveLlmRoute("image.role_prompt");
      if (resolved.status !== "ready") {
        throw apiError(`角色定位 LLM 路由不可用：${resolved.status}`, 500);
      }
      const task = await promptReverseTaskModel().create({
        data: {
          authUserId: currentUser.id,
          userId: String(currentUser.id),
          status: "pending",
          surface,
          systemPrompt,
          skillSource: resolvedSkill?.source ?? null,
          skillId: resolvedSkill?.id ?? null,
          skillName: resolvedSkill?.name ?? null,
          skillRevision: resolvedSkill?.revision ?? null,
          userPrompt,
          requestedModel: null,
          llmProviderId: resolved.route.providerId,
          model: resolved.route.modelId,
          mediaUrls: rawMediaUrls,
        },
      });
      void runPromptReverseTask(task.id, req.nextUrl.origin).catch((error) => {
        console.error("[prompt-reverse] async task crashed", error);
      });
      return json({ success: true, task: serializePromptReverseTask(task) }, { status: 202 });
    }

    const resolved = await resolveLlmRoute("image.role_prompt");
    if (resolved.status !== "ready") {
      throw apiError(`角色定位 LLM 路由不可用：${resolved.status}`, 500);
    }
    const result = await generatePromptReverse({
      route: resolved.route,
      systemPrompt,
      userPrompt,
      rawMediaUrls,
      origin: req.nextUrl.origin,
      logUserId,
      startAt,
    });
    return json({
      success: true,
      generatedPrompt: result.generatedPrompt,
      llmProviderId: result.llmProviderId,
      model: result.model,
    });
  } catch (e: any) {
    const message = publicPromptReverseError(e);
    if (logUserId) {
      await Logger.log({
        userId: logUserId,
        category: "api",
        action: "prompt_reverse",
        level: "error",
        message,
        duration: Date.now() - startAt,
      });
    }
    return json({ success: false, error: apiErrorMessage(message) }, { status: Number(e?.statusCode) || 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) return json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const surface = parseRolePositioningSurface(
    searchParams.get("surface"),
    "toolbox_image",
  );
  if (!surface) {
    return json({ success: false, error: apiMessage("m0db5dbf5d5c3") }, { status: 400 });
  }
  const id = Number.parseInt(String(searchParams.get("id") || ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return json({ success: false, error: apiMessage("mc542c4204ec9") }, { status: 400 });
  }

  const task = await promptReverseTaskModel().findFirst({
    where: { id, authUserId: currentUser.id, surface, deletedAt: null },
  });
  if (!task) return json({ success: false, error: apiMessage("m1d49c854d44a") }, { status: 404 });

  await promptReverseTaskModel().update({
    where: { id: task.id },
    data: { deletedAt: new Date() },
  });
  return json({ success: true });
}
