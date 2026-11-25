import { apiErrorMessage } from "@/i18n/api-message";
﻿import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope, type AdminUserScope } from "@/lib/admin-user-scope";
import { normalizeMediaUrl } from "@/lib/media-url";
import { resolvePublicPath } from "@/lib/public-path";
import { getInspirationTemplatesByGenerationIds } from "@/lib/inspiration-template-service";
import { isDesktopMode } from "@/lib/desktop-mode";
import { buildModelFailurePeriods } from "@/lib/admin-model-failure";
import { loadAdminUserModelCounts } from "@/lib/admin/model-call-source";
import { loadAdminBillingTrend } from "@/lib/admin/billing-trend";
import {
  buildWorksWhere,
  normalizeAdminWorksSourceFilter,
  parseAdminWorksAdminKey,
} from "@/lib/admin-user-works";
import { isAssetBatchMode } from "@/lib/assets/source-filter";
import { buildAdminUserStorageSummary } from "@/lib/admin-user-storage-summary";
import { loadAdminAnalysisTrends, loadAdminStorageSummary } from "@/lib/admin/analysis-aggregates";
import {
  ensureLegacyBuiltinPromptsMigrated,
  ensureLegacyUserPromptsMigrated,
} from "@/lib/prompt-presets/migration";
import { ensureCanvasPromptSeeds } from "@/lib/prompt-presets/builtin-seeds";
import { listEffectivePromptPresets } from "@/lib/prompt-presets/repository";
import { preparePromptPresetRead } from "@/lib/prompt-presets/read-preparation";
import type { PromptPresetDto } from "@/lib/prompt-presets/contracts";
import { listRoleSkillsForAdminAudit } from "@/lib/role-skills/repository";
import type { RoleSkillDetail } from "@/lib/role-skills/contracts";
import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

export const runtime = "nodejs";

const PRESET_SCOPES = ["face_swap", "face_defect", "face_swap_defect", "image", "video"] as const;
const preferenceModelLabels = new Map(TOOLBOX_MODEL_DEFINITIONS.map((model) => [model.id, model.label] as const));

type SafeJson = Record<string, any>;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

function safeUserId(v: string) {
  const s = (v || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) return "";
  if (s === "_builtin") return "";
  return s;
}

function toDiskPath(localPath: string) {
  const p = String(localPath || "");
  if (!p.startsWith("/uploads/")) return null;
  const rel = p.replace(/^\//, "");
  return resolvePublicPath(rel);
}

function parseJson(text: string | null | undefined): SafeJson | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return v as SafeJson;
  } catch {
    return null;
  }
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mergeMetadataList(logs: Array<{ generationId: number | null; metadata: string | null; action: string }>) {
  const merged = new Map<number, SafeJson>();
  for (const log of logs) {
    if (!log.generationId) continue;
    const parsed = parseJson(log.metadata);
    if (!parsed) continue;
    const prev = merged.get(log.generationId) || {};
    const next = { ...prev, ...parsed };
    if (log.action === "task_success" && Object.prototype.hasOwnProperty.call(prev, "duration")) {
      next.duration = (prev as any).duration;
    }
    merged.set(log.generationId, next);
  }
  return merged;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function mergeParamsPreferFilled(
  current: Record<string, any> | null | undefined,
  incoming: Record<string, any> | null | undefined
): Record<string, any> | null {
  if (!current && !incoming) return null;
  if (!current) return incoming ? { ...incoming } : null;
  if (!incoming) return { ...current };
  const out: Record<string, any> = { ...current };
  for (const [key, nextVal] of Object.entries(incoming)) {
    const prevVal = out[key];
    if (prevVal && typeof prevVal === "object" && !Array.isArray(prevVal) && nextVal && typeof nextVal === "object" && !Array.isArray(nextVal)) {
      out[key] = mergeParamsPreferFilled(prevVal as Record<string, any>, nextVal as Record<string, any>) || prevVal;
      continue;
    }
    if (!hasMeaningfulValue(prevVal) && hasMeaningfulValue(nextVal)) {
      out[key] = nextVal;
    }
  }
  return out;
}

function inc(map: Record<string, number>, key: string, by = 1) {
  const k = String(key || "").trim() || "未标注";
  map[k] = (map[k] || 0) + by;
}

function preferenceTaskTypeLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "image_edit") return "图片编辑";
  if (normalized === "video_gen" || normalized === "video_generate") return "视频生成";
  if (normalized === "audio_gen") return "音频生成";
  if (normalized === "face_swap") return "人脸替换";
  return value;
}

function preferenceAspectRatioLabel(value: string) {
  return value === "adaptive" || value === "auto" ? "自适应" : value;
}

function safePage(v: string | null, fallback = 1) {
  const n = Number(v || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function safePageSize(v: string | null, fallback = 20) {
  const n = Number(v || fallback);
  if (!Number.isFinite(n)) return fallback;
  // 上限放到 1000，配合管理员"资产素材"批量管理（前端可选 100/500/1000）。
  // 超出此值的请求会被夹回 1000，避免单次拉表过大拖慢 DB。
  return Math.min(1000, Math.max(1, Math.floor(n)));
}

function safeMaterialDate(raw: string | null, endOfDay = false) {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractInputMaterials(meta: SafeJson | null, generation: { type: string }) {
  const taskType = String(meta?.taskType || "").trim().toLowerCase();
  const mediaPath = String(meta?.mediaPath || "").trim();
  const inputUrl = String(meta?.inputUrl || meta?.image_url || "").trim();
  if (generation.type === "video_gen" || generation.type === "video_generate" || taskType === "video_gen" || taskType === "video_generate") {
    const videoInputs: string[] = [];
    const pushVideoInput = (v: any) => {
      const s = normalizeMediaUrl(v);
      if (!s || s.startsWith("asset://")) return;
      videoInputs.push(s);
    };
    if (Array.isArray(meta?.inputMedia)) {
      for (const item of meta.inputMedia) {
        pushVideoInput((item as any)?.url);
      }
    }
    pushVideoInput(meta?.inputPreviewUrl);
    pushVideoInput(mediaPath);
    pushVideoInput(inputUrl);
    if (videoInputs.length) return [...new Set(videoInputs)].slice(0, 12);
  }
  const out: string[] = [];
  const push = (v: any) => {
    const s = normalizeMediaUrl(v);
    if (!s || s.startsWith("asset://")) return;
    out.push(s);
  };
  const pushArray = (v: any) => {
    if (!Array.isArray(v)) return;
    for (const x of v) push(x);
  };
  if (meta) {
    pushArray(meta.imagePaths);
    pushArray(meta.inputImages);
    pushArray(meta.inputPaths);
    pushArray(meta.sourceImages);
    pushArray(meta.fileUrls);
    pushArray(meta.image_urls);
    pushArray(meta.output_images);
    push(meta.imagePath);
    push(meta.sourcePath);
    push(mediaPath);
    push(meta.localInputPath);
    push(meta.facePath);
    push(meta.targetPath);
    push(meta.fileUrl);
    push(inputUrl);
  }
  return [...new Set(out)].slice(0, 6);
}

function toPathArray(v: any) {
  if (!Array.isArray(v)) return [] as string[];
  return v.map((x) => normalizeMediaUrl(x)).filter(Boolean);
}

function extractOutputPaths(meta: SafeJson | null, localPath: string | null | undefined) {
  const out: string[] = [];
  const push = (v: any) => {
    const s = normalizeMediaUrl(v);
    if (!s) return;
    out.push(s);
  };
  const p = meta || {};
  push(localPath || "");
  toPathArray(p.outputPaths).forEach(push);
  toPathArray(p.output_images).forEach(push);
  toPathArray(p.image_urls).forEach(push);
  toPathArray(p.resultUrls).forEach(push);
  if (Array.isArray(p.outputs)) {
    for (const x of p.outputs) push((x as any)?.url || (x as any)?.video_url || x);
  }
  return Array.from(new Set(out));
}

function legacyScopeCategory(scope: (typeof PRESET_SCOPES)[number]) {
  if (scope === "face_swap") return "人脸替换";
  if (scope === "face_defect") return "添加瑕疵";
  if (scope === "face_swap_defect") return "替换并加瑕疵";
  if (scope === "image") return "图片编辑";
  return "视频生成";
}

async function readPresetFile(
  userId: string,
  scope: (typeof PRESET_SCOPES)[number],
): Promise<{ presets: PromptPresetDto[]; deletedCount: number }> {
  const filePath = resolvePublicPath("uploads", "presets", userId, `${scope}.json`);
  const exists = await fs.pathExists(filePath);
  if (!exists) return { presets: [], deletedCount: 0 };
  try {
    const json = await fs.readJson(filePath);
    if (!Array.isArray(json)) return { presets: [], deletedCount: 0 };
    let deletedCount = 0;
    const presets = json
      .map<PromptPresetDto | null>((x: any) => {
        const id = String(x?.id || "").trim();
        const name = String(x?.name || "").trim();
        const content = String(x?.content || "").trim();
        if (!id || !name || !content) return null;
        if (String(x?.deletedAt || "").trim()) {
          deletedCount += 1;
          return null;
        }
        const category =
          String(x?.category || "").trim()
          || String(x?.groupName || "").trim()
          || legacyScopeCategory(scope);
        const createdAt =
          typeof x?.createdAt === "string" && !Number.isNaN(Date.parse(x.createdAt))
            ? new Date(x.createdAt).toISOString()
            : typeof x?.updatedAt === "string" && !Number.isNaN(Date.parse(x.updatedAt))
              ? new Date(x.updatedAt).toISOString()
              : new Date(0).toISOString();
        const updatedAt =
          typeof x?.updatedAt === "string" && !Number.isNaN(Date.parse(x.updatedAt))
            ? new Date(x.updatedAt).toISOString()
            : createdAt;
        return {
          id: `legacy-readonly:${userId}:${scope}:${id}`,
          name,
          category,
          content,
          source: "custom",
          revision: 1,
          createdAt,
          updatedAt,
        } satisfies PromptPresetDto;
      })
      .filter((x): x is PromptPresetDto => x !== null);
    return { presets, deletedCount };
  } catch {
    return { presets: [], deletedCount: 0 };
  }
}

function withAnd(base: Record<string, unknown>, extra?: Record<string, unknown>) {
  if (!extra || Object.keys(extra).length === 0) return base;
  return { AND: [base, extra] };
}

function usageWhereForScope(scopeInfo: { authUserId: number | null; linkedGuestUserIds: string[] }) {
  if (typeof scopeInfo.authUserId === "number") {
    return {
      OR: [
        { authUserId: scopeInfo.authUserId },
        { authUserId: null, userId: { in: scopeInfo.linkedGuestUserIds } }
      ]
    };
  }
  return { authUserId: null, userId: { in: scopeInfo.linkedGuestUserIds } };
}

function serializeMaterialAssetLite(asset: any) {
  return {
    id: asset.id,
    category: asset.category || null,
    title: asset.title,
    imageUrl: asset.imageUrl,
    thumbnailUrl: asset.thumbnailUrl || null,
    previewUrl: asset.previewUrl || null,
    mimeType: asset.mimeType || null,
    sizeBytes: asset.sizeBytes || 0,
    mediaCount: Math.max(1, Number(asset.mediaCount || 1)),
    selectedMediaId: asset.selectedMediaId || null,
    creatorName: asset.creatorName || null,
    selectedByUserId: asset.selectedByUserId || null,
    selectedByUsername: asset.selectedByUser?.username || null,
    selectedAt: toIso(asset.selectedAt),
    createdAt: toIso(asset.createdAt),
    downloadCount: asset._count?.downloads || 0,
  };
}

function serializeMaterialAssetEvent(event: any) {
  const asset = event.asset || null;
  return {
    id: event.id,
    assetId: event.assetId,
    userId: event.userId,
    username: event.username,
    action: event.action,
    reason: event.reason || null,
    operatorUsername: event.operatorUsername || null,
    selectedMediaId: event.selectedMediaId || null,
    selectedMediaUrl: event.selectedMediaUrl || null,
    occurredAt: toIso(event.occurredAt),
    asset: asset
      ? {
          id: asset.id,
          category: asset.category || null,
          title: asset.title,
          imageUrl: asset.imageUrl,
          thumbnailUrl: asset.thumbnailUrl || null,
          previewUrl: asset.previewUrl || null,
          mimeType: asset.mimeType || null,
          sizeBytes: asset.sizeBytes || 0,
          mediaCount: Math.max(1, Number(asset.mediaCount || 1)),
          selectedMediaId: asset.selectedMediaId || null,
          creatorName: asset.creatorName || null,
          isDeleted: Boolean(asset.isDeleted),
          isSelected: Boolean(asset.selectedByUserId),
          selectedByUserId: asset.selectedByUserId || null,
          selectedByUsername: asset.selectedByUser?.username || null,
        }
      : {
          id: event.assetId,
          category: event.assetCategory || null,
          title: event.assetTitle || `素材 #${event.assetId}`,
          imageUrl: event.assetImageUrl || "",
          thumbnailUrl: event.assetThumbnailUrl || null,
          previewUrl: null,
          mimeType: null,
          sizeBytes: 0,
          mediaCount: 1,
          selectedMediaId: event.selectedMediaId || null,
          selectedMediaUrl: event.selectedMediaUrl || null,
          isDeleted: false,
          isSelected: false,
          selectedByUserId: null,
        },
  };
}

async function loadAdminPromptPresets(
  scopeInfo: Pick<
    AdminUserScope,
    "requestedUserId" | "authUserId" | "presetUserIds"
  >,
): Promise<{ presets: PromptPresetDto[]; deletedCount: number }> {
  if (typeof scopeInfo.authUserId === "number") {
    await preparePromptPresetRead([
      {
        name: "legacy-user-migration",
        run: () => ensureLegacyUserPromptsMigrated({
          authUserId: scopeInfo.authUserId as number,
          presetUserIds: scopeInfo.presetUserIds,
        }),
      },
      {
        name: "legacy-builtin-migration",
        run: ensureLegacyBuiltinPromptsMigrated,
      },
      { name: "canvas-seeds", run: ensureCanvasPromptSeeds },
    ]);
    const [presets, deletedCount] = await Promise.all([
      listEffectivePromptPresets({ authUserId: scopeInfo.authUserId }),
      prisma.promptPreset.count({
        where: {
          authUserId: scopeInfo.authUserId,
          deletedAt: { not: null },
        },
      }),
    ]);
    return { presets, deletedCount };
  }

  const guestUserId = safeUserId(scopeInfo.requestedUserId);
  if (!guestUserId) return { presets: [], deletedCount: 0 };
  const lists = await Promise.all(
    PRESET_SCOPES.map((scope) => readPresetFile(guestUserId, scope)),
  );
  return {
    presets: lists.flatMap((result) => result.presets),
    deletedCount: lists.reduce(
      (total, result) => total + result.deletedCount,
      0,
    ),
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const { searchParams } = new URL(req.url);
  const section = String(searchParams.get("section") || "full").trim().toLowerCase();
  const includeGenerationDetails = section === "full" || section === "works";
  const includeMaterialDetail = section === "full" || section === "materials";
  const includeFeedbackDetail = section === "full" || section === "feedback";
  const includeAnalysisDetails = section === "full" || section === "analysis";
  const includePresetDetail = section === "full" || section === "presets";
  const includeSkillDetail = section === "full" || section === "skills";
  const explicitIdentity = parseAdminWorksAdminKey(searchParams.get("adminKey"));
  if (searchParams.has("adminKey") && !explicitIdentity) return bad("adminKey 无效");
  const legacyUserId = safeUserId(searchParams.get("userId") || "");
  const authUserIdRaw = Number(searchParams.get("authUserId"));
  const legacyAuthUserId = searchParams.has("authUserId") && Number.isSafeInteger(authUserIdRaw) && authUserIdRaw > 0
    ? authUserIdRaw
    : null;
  if (searchParams.has("authUserId") && legacyAuthUserId == null) return bad("authUserId 无效");
  if (explicitIdentity && legacyUserId && legacyUserId !== explicitIdentity.userId) return bad("adminKey 与 userId 不一致");
  if (explicitIdentity && searchParams.has("authUserId") && legacyAuthUserId !== explicitIdentity.authUserId) {
    return bad("adminKey 与 authUserId 不一致");
  }
  const userId = explicitIdentity?.userId || legacyUserId;
  const authUserId = explicitIdentity?.authUserId ?? legacyAuthUserId;
  if (!userId) return bad("userId 无效");
  const scopeInfo = await resolveAdminUserScope(userId, authUserId, { explicitIdentity: true });
  const presetsPromise = includePresetDetail
    ? loadAdminPromptPresets(scopeInfo)
    : Promise.resolve({ presets: [] as PromptPresetDto[], deletedCount: 0 });
  const roleSkillsPromise = includeSkillDetail
    ? listRoleSkillsForAdminAudit({ authUserId: scopeInfo.authUserId })
    : Promise.resolve([] as RoleSkillDetail[]);
  const modelFailureNow = new Date();
  const analysisTrendsPromise = includeAnalysisDetails
    ? loadAdminAnalysisTrends(scopeInfo, modelFailureNow)
    : Promise.resolve({ daily14: {} as Record<string, number>, activeDays: 0, dailyByCategory: {} as Record<string, Record<string, number>>, modelFailurePeriods: buildModelFailurePeriods([], modelFailureNow) });

  const page = safePage(searchParams.get("page"), 1);
  const pageSize = safePageSize(searchParams.get("pageSize"), 20);
  const materialPage = safePage(searchParams.get("materialPage"), 1);
  const materialPageSize = Math.min(100, Math.max(12, safePageSize(searchParams.get("materialPageSize"), 60)));
  const materialArchivedPage = safePage(searchParams.get("materialArchivedPage"), 1);
  const materialArchivedPageSize = Math.min(100, Math.max(12, safePageSize(searchParams.get("materialArchivedPageSize"), 50)));
  const includeArchivedMaterials = searchParams.get("includeArchivedMaterials") === "1";
  const materialEventPage = safePage(searchParams.get("materialEventPage"), 1);
  const materialEventPageSize = Math.min(100, Math.max(12, safePageSize(searchParams.get("materialEventPageSize"), 20)));
  const includeMaterialEvents = searchParams.get("includeMaterialEvents") === "1";
  const materialEventActionRaw = String(searchParams.get("materialEventAction") || "all").trim().toLowerCase();
  const materialEventAction = ["select", "cancel_request", "release"].includes(materialEventActionRaw) ? materialEventActionRaw : "all";
  const materialCategory = String(searchParams.get("materialCategory") || "all").trim();
  const materialSelectedFrom = safeMaterialDate(searchParams.get("materialSelectedFrom"));
  const materialSelectedTo = safeMaterialDate(searchParams.get("materialSelectedTo"), true);
  const kind = String(searchParams.get("kind") || "all").trim().toLowerCase();
  const typeFilter = String(searchParams.get("typeFilter") || "all").trim().toLowerCase();
  const source = String(searchParams.get("source") || "creation").trim().toLowerCase();
  const batchModeRaw = String(searchParams.get("batchMode") || "").trim();
  if (source === "batch" && batchModeRaw && !isAssetBatchMode(batchModeRaw)) {
    return bad("invalid batchMode");
  }
  const sourceFilter = normalizeAdminWorksSourceFilter(source, batchModeRaw);
  const listWhere = await buildWorksWhere(scopeInfo, kind, typeFilter, sourceFilter);

  // 账号/日志/计费/Agent 等统计与下面的资产聚合互不依赖，提前并发启动，
  // 与主聚合查询同时跑（不再排在它们后面串行等待），最后再 await 取结果，显著缩短总耗时。
  const usageWhere = usageWhereForScope(scopeInfo);
  const billingTrendPromise = includeAnalysisDetails
    ? loadAdminBillingTrend(scopeInfo).catch(() => null)
    : Promise.resolve(null);
  const agentUserId = typeof scopeInfo.authUserId === "number" ? scopeInfo.authUserId : null;
  const userStorageSummaryPromise = includeAnalysisDetails
    ? loadAdminStorageSummary(scopeInfo)
    : Promise.resolve(buildAdminUserStorageSummary([]));
  const accountStatsPromise = Promise.all([
    typeof scopeInfo.authUserId === "number"
      ? prisma.user.findUnique({
          where: { id: scopeInfo.authUserId },
          select: { id: true, username: true, createdAt: true, updatedAt: true }
        }).catch(() => null)
      : Promise.resolve(null),
    includeAnalysisDetails
      ? prisma.log.count({ where: scopeInfo.logWhere as any }).catch(() => 0)
      : Promise.resolve(0),
    includeAnalysisDetails
      ? prisma.log.groupBy({
          by: ["category"],
          where: scopeInfo.logWhere as any,
          _count: { _all: true }
        }).catch(() => [])
      : Promise.resolve([]),
    includeAnalysisDetails
      ? prisma.log.groupBy({
          by: ["level"],
          where: scopeInfo.logWhere as any,
          _count: { _all: true }
        }).catch(() => [])
      : Promise.resolve([]),
    includeAnalysisDetails
      ? prisma.log.count({
          where: withAnd(scopeInfo.logWhere as any, { action: "feedback_submit" }) as any
        }).catch(() => 0)
      : Promise.resolve(0),
    includeAnalysisDetails && typeof scopeInfo.authUserId === "number"
      ? prisma.mediaLibraryItem.aggregate({
          where: { ownerUserId: scopeInfo.authUserId, isDeleted: false },
          _count: { _all: true },
          _sum: { sizeBytes: true }
        }).catch(() => null)
      : Promise.resolve(null),
    includeAnalysisDetails
      ? prisma.usageLedger.aggregate({
          where: usageWhere as any,
          _count: { _all: true },
          _sum: { amount: true }
        }).catch(() => null)
      : Promise.resolve(null),
    includeAnalysisDetails
      ? prisma.usageLedger.groupBy({
          by: ["costStatus"],
          where: usageWhere as any,
          _count: { _all: true },
          _sum: { amount: true }
        }).catch(() => [])
      : Promise.resolve([]),
    includeAnalysisDetails
      ? prisma.usageLedger.groupBy({
          by: ["module"],
          where: usageWhere as any,
          _count: { _all: true },
          _sum: { amount: true }
        }).catch(() => [])
      : Promise.resolve([]),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.agentConversation.count({ where: { userId: agentUserId } }).catch(() => 0)
      : Promise.resolve(0),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.agentConversation.groupBy({
          by: ["status"],
          where: { userId: agentUserId },
          _count: { _all: true }
        }).catch(() => [])
      : Promise.resolve([]),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.agentMessage.count({ where: { userId: agentUserId } }).catch(() => 0)
      : Promise.resolve(0),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.userMemory.count({ where: { userId: agentUserId, isActive: true } }).catch(() => 0)
      : Promise.resolve(0),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.userMemory.count({ where: { userId: agentUserId } }).catch(() => 0)
      : Promise.resolve(0),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.agentRun.aggregate({
          where: { userId: agentUserId },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true },
          _avg: { latencyMs: true }
        }).catch(() => null)
      : Promise.resolve(null),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.agentRun.groupBy({
          by: ["status"],
          where: { userId: agentUserId },
          _count: { _all: true }
        }).catch(() => [])
      : Promise.resolve([]),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.agentRun.groupBy({
          by: ["model"],
          where: { userId: agentUserId },
          _count: { _all: true }
        }).catch(() => [])
      : Promise.resolve([]),
    includeAnalysisDetails && agentUserId !== null
      ? prisma.agentRun.groupBy({
          by: ["purpose"],
          where: { userId: agentUserId },
          _count: { _all: true }
        }).catch(() => [])
      : Promise.resolve([])
  ]);

  const [
    allGenerations,
    listTotal,
    generations,
    byType,
    byStatus,
    bySource,
    byModel,
    promptPresetDetail,
    roleSkills,
    totalBytesAgg,
    dateAgg,
    generatedSuccessTotal,
    referencedFileTotal
  ] = await Promise.all([
    includeGenerationDetails
      ? prisma.generation.findMany({
          where: scopeInfo.generationWhere as any,
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          // 只取后续聚合统计需要的字段;别再把 prompt / templateData 整列拉进内存
          select: {
            id: true,
            type: true,
            status: true,
            model: true,
            source: true,
            createdAt: true,
            finishedAt: true,
            localPath: true,
            externalTaskId: true,
          },
        })
      : Promise.resolve([]),
    prisma.generation.count({
      where: listWhere
    }),
    includeGenerationDetails
      ? prisma.generation.findMany({
          where: listWhere,
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize
        })
      : Promise.resolve([]),
    prisma.generation.groupBy({
      by: ["type"],
      where: scopeInfo.generationWhere as any,
      _count: { _all: true }
    }),
    prisma.generation.groupBy({
      by: ["status"],
      where: scopeInfo.generationWhere as any,
      _count: { _all: true }
    }),
    includeAnalysisDetails
      ? prisma.generation.groupBy({
          by: ["source"],
          where: scopeInfo.generationWhere as any,
          _count: { _all: true }
        })
      : Promise.resolve([]),
    includeAnalysisDetails
      ? loadAdminUserModelCounts(scopeInfo)
      : Promise.resolve([]),
    presetsPromise,
    roleSkillsPromise,
    // 用数据库聚合代替原来的 fs.stat 遍历,sizeBytes 由生成/导入时写入。
    prisma.generation.aggregate({
      where: scopeInfo.generationWhere as any,
      _sum: { sizeBytes: true }
    }).catch(() => ({ _sum: { sizeBytes: null as number | null } })),
    prisma.generation.aggregate({
      where: scopeInfo.generationWhere as any,
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true, finishedAt: true }
    }).catch(() => ({ _count: { _all: 0 }, _min: { createdAt: null }, _max: { createdAt: null, finishedAt: null } })),
    prisma.generation.count({
      where: withAnd(scopeInfo.generationWhere, { type: { not: "import" }, status: "success" }) as any
    }).catch(() => 0),
    prisma.generation.count({
      where: withAnd(scopeInfo.generationWhere, { localPath: { not: null } }) as any
    }).catch(() => 0)
  ]);

  const externalTaskIds = includeGenerationDetails
    ? Array.from(new Set(generations.map((g) => String(g.externalTaskId || "").trim()).filter(Boolean)))
    : [];
  const peerRows =
    externalTaskIds.length > 0
      ? await prisma.generation.findMany({
          where: withAnd(scopeInfo.generationWhere, { externalTaskId: { in: externalTaskIds } }) as any,
          select: { id: true, type: true, externalTaskId: true, localPath: true, templateData: true }
        })
      : [];

  const generationIds = includeGenerationDetails ? Array.from(new Set([...allGenerations.map((g) => g.id), ...peerRows.map((g) => g.id)])) : [];
  const [generationLogs, recentLogs, feedbackLogs] = await Promise.all([
    generationIds.length
      ? prisma.log.findMany({
          where: {
            ...(scopeInfo.logWhere as any),
            generationId: { in: generationIds },
            category: "generation",
            action: { in: ["task_create", "task_success"] },
            metadata: { not: null }
          },
          orderBy: { createdAt: "asc" }
        })
      : Promise.resolve([]),
    includeAnalysisDetails
      ? prisma.log.findMany({
          where: scopeInfo.logWhere as any,
          orderBy: { createdAt: "desc" },
          take: 40
        })
      : Promise.resolve([]),
    includeFeedbackDetail
      ? prisma.log.findMany({
          where: withAnd(scopeInfo.logWhere as any, { action: "feedback_submit" }) as any,
          orderBy: { createdAt: "desc" },
          take: 120
        })
      : Promise.resolve([])
  ]);

  const paramsByGeneration = new Map<number, SafeJson | null>();
  const templateParamsByGeneration = new Map<number, SafeJson>();
  for (const row of [...generations, ...peerRows] as Array<{ id: number; templateData?: string | null }>) {
    const parsed = parseJson(row.templateData);
    if (parsed) templateParamsByGeneration.set(row.id, parsed);
  }
  const mergedMeta = mergeMetadataList(generationLogs as Array<{ generationId: number | null; metadata: string | null; action: string }>);
  for (const id of generationIds) {
    paramsByGeneration.set(
      id,
      mergeParamsPreferFilled(templateParamsByGeneration.get(id) || null, mergedMeta.get(id) || null)
    );
  }

  const byModelMap: Record<string, number> = !includeAnalysisDetails && allGenerations.length
    ? {}
    : Object.fromEntries((byModel as Array<{ model: string | null; _count: { _all: number } }>).map((x) => [x.model || "未标注", x._count._all] as const));
  for (const g of includeAnalysisDetails ? [] : allGenerations) {
    if (g.type === "import") continue;
    inc(byModelMap, g.model || "未标注");
  }

  const paramStats = {
    aspectRatio: {} as Record<string, number>,
    resolution: {} as Record<string, number>,
    taskType: {} as Record<string, number>,
    speed: {} as Record<string, number>,
    version: {} as Record<string, number>
  };
  for (const [gid, meta] of paramsByGeneration.entries()) {
    if (!meta) continue;
    const m = meta as SafeJson;
    const aspect = String(m.aspectRatio || m.aspect_ratio || m.ratio || "").trim();
    const resolution = String(m.resolution || "").trim();
    const taskType = String(m.taskType || m.task_type || "").trim();
    const speed = String(m.speed || "").trim();
    const version = String(m.version || "").trim();
    if (aspect) inc(paramStats.aspectRatio, aspect);
    if (resolution) inc(paramStats.resolution, resolution);
    if (taskType) inc(paramStats.taskType, taskType);
    if (speed) inc(paramStats.speed, speed);
    if (version) inc(paramStats.version, version);
    if (!aspect && !resolution && !taskType && !speed && !version) {
      const g = allGenerations.find((x) => x.id === gid);
      if (g?.type) inc(paramStats.taskType, g.type);
    }
  }

  const preferenceFlowMap = new Map<string, { model: string; taskType: string; aspectRatio: string; resolution: string; value: number }>();
  for (const generation of allGenerations) {
    if (generation.type === "import") continue;
    const meta = paramsByGeneration.get(generation.id);
    const rawModel = String(generation.model || "").trim();
    const rawTaskType = String(meta?.taskType || meta?.task_type || generation.type || "").trim();
    const rawAspectRatio = String(meta?.aspectRatio || meta?.aspect_ratio || meta?.ratio || "").trim();
    const model = rawModel ? preferenceModelLabels.get(rawModel) || rawModel : "未标注";
    const taskType = rawTaskType ? preferenceTaskTypeLabel(rawTaskType) : "未标注";
    const aspectRatio = rawAspectRatio ? preferenceAspectRatioLabel(rawAspectRatio) : "未设置";
    const resolution = String(meta?.resolution || "").trim() || "未设置";
    const key = `${model}\u0000${taskType}\u0000${aspectRatio}\u0000${resolution}`;
    const current = preferenceFlowMap.get(key);
    if (current) {
      current.value += 1;
    } else {
      preferenceFlowMap.set(key, { model, taskType, aspectRatio, resolution, value: 1 });
    }
  }
  const preferenceFlows = Array.from(preferenceFlowMap.values()).sort(
    (a, b) => b.value - a.value || a.model.localeCompare(b.model, "zh-CN")
  );

  const { daily14, activeDays, modelFailurePeriods, dailyByCategory: logDailyByCategory } = await analysisTrendsPromise;

  // 旧版每次 GET 都对每个 localPath 跑 fs.stat,几百条记录就是几百次磁盘 IO。
  // 改成 Prisma aggregate 读数据库里缓存的 sizeBytes —— 毫秒级。
  const totalBytes = Math.max(0, Number((totalBytesAgg as any)?._sum?.sizeBytes || 0));
  const totalReferencedFiles = allGenerations.length
    ? allGenerations.reduce((acc, g) => acc + (g.localPath ? 1 : 0), 0)
    : Number(referencedFileTotal || 0);

  const totalGenerationRecords = allGenerations.length || Number((dateAgg as any)?._count?._all || listTotal || 0);
  const importCount = allGenerations.length
    ? allGenerations.filter((g) => g.type === "import").length
    : Number((byType as Array<{ type: string | null; _count: { _all: number } }>).find((x) => x.type === "import")?._count?._all || 0);
  const generatedSuccessCount = allGenerations.length
    ? allGenerations.filter((g) => g.type !== "import" && g.status === "success").length
    : Number(generatedSuccessTotal || 0);
  const failedCount = allGenerations.length
    ? allGenerations.filter((g) => g.status === "failed").length
    : Number((byStatus as Array<{ status: string | null; _count: { _all: number } }>).find((x) => x.status === "failed")?._count?._all || 0);
  const successRate = totalGenerationRecords ? Math.round((generatedSuccessCount / Math.max(1, totalGenerationRecords - importCount)) * 100) : 0;
  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const firstGenerationAt = allGenerations.length
    ? allGenerations.reduce<string | null>((earliest, row) => {
        const iso = toIso(row.createdAt);
        if (!iso) return earliest;
        return !earliest || iso < earliest ? iso : earliest;
      }, null)
    : toIso((dateAgg as any)?._min?.createdAt);
  const lastGenerationAt = allGenerations.length
    ? allGenerations.reduce<string | null>((latest, row) => {
        const iso = toIso(row.createdAt);
        if (!iso) return latest;
        return !latest || iso > latest ? iso : latest;
      }, null)
    : toIso((dateAgg as any)?._max?.createdAt);
  const lastFinishedAt = allGenerations.length
    ? allGenerations.reduce<string | null>((latest, row) => {
        const iso = toIso(row.finishedAt);
        if (!iso) return latest;
        return !latest || iso > latest ? iso : latest;
      }, null)
    : toIso((dateAgg as any)?._max?.finishedAt);

  const [
    authUser,
    totalLogs,
    logsByCategory,
    logsByLevel,
    totalFeedbacks,
    mediaLibraryStats,
    billingTotal,
    billingByStatus,
    billingByModule,
    agentConversationTotal,
    agentConversationsByStatus,
    agentMessageTotal,
    activeMemoryTotal,
    memoryTotal,
    agentRunTotal,
    agentRunsByStatus,
    agentRunsByModel,
    agentRunsByPurpose
  ] = await accountStatsPromise;
  const storage = await userStorageSummaryPromise;
  const billingAmount = Number(billingTotal?._sum?.amount || 0);
  const billingRecordCount = Number(billingTotal?._count?._all || 0);
  const agentRunCount = Number(agentRunTotal?._count?._all || 0);

  const groupedOutputPaths = new Map<string, string[]>();
  const groupedInputMaterials = new Map<string, string[]>();
  const groupedParams = new Map<string, SafeJson | null>();
  const groupedGenerationIds = new Map<string, number[]>();
  const allRowsForGrouping = Array.from(
    new Map<number, { id: number; type: string; externalTaskId: string | null; localPath: string | null }>(
      [...allGenerations, ...peerRows].map((x) => [x.id, x])
    ).values()
  );
  const inspirationTemplatesByGenerationId = generationIds.length && !isDesktopMode()
    ? await getInspirationTemplatesByGenerationIds(generationIds)
    : new Map<number, { sourceGenerationId: number; templateId: number }>();
  for (const row of allRowsForGrouping) {
    const key = String(row.externalTaskId || "").trim() ? `${row.type}:${String(row.externalTaskId || "").trim()}` : `id:${row.id}`;
    const prev = groupedOutputPaths.get(key) || [];
    const merged = Array.from(new Set([...prev, ...extractOutputPaths(paramsByGeneration.get(row.id) ?? null, row.localPath)]));
    groupedOutputPaths.set(key, merged);
    const inputPrev = groupedInputMaterials.get(key) || [];
    const inputMerged = Array.from(new Set([...inputPrev, ...extractInputMaterials(paramsByGeneration.get(row.id) ?? null, row as any)]));
    groupedInputMaterials.set(key, inputMerged);
    const prevParams = groupedParams.get(key) || null;
    groupedParams.set(key, mergeParamsPreferFilled(prevParams, paramsByGeneration.get(row.id) ?? null));
    groupedGenerationIds.set(key, Array.from(new Set([...(groupedGenerationIds.get(key) || []), row.id])));
  }

  const uploadedMaterialSet = new Set<string>();
  for (const row of allRowsForGrouping) {
    const key = String(row.externalTaskId || "").trim() ? `${row.type}:${String(row.externalTaskId || "").trim()}` : `id:${row.id}`;
    const inputs = groupedInputMaterials.get(key) || extractInputMaterials(paramsByGeneration.get(row.id) ?? null, row as any);
    for (const material of inputs) {
      const normalized = normalizeMediaUrl(material);
      if (!normalized) continue;
      uploadedMaterialSet.add(normalized);
    }
    if (row.type === "import" && row.localPath) {
      const normalizedImport = normalizeMediaUrl(row.localPath);
      if (normalizedImport) uploadedMaterialSet.add(normalizedImport);
    }
  }

  const materialActiveBaseWhere =
    typeof scopeInfo.authUserId === "number"
      ? {
          selectedByUserId: scopeInfo.authUserId,
          isDeleted: false
        }
      : {};
  const materialActiveAnd: any[] = [materialActiveBaseWhere];
  if (materialCategory && materialCategory !== "all") {
    materialActiveAnd.push(materialCategory === "__uncategorized" ? { OR: [{ category: null }, { category: "" }] } : { category: materialCategory });
  }
  const materialSelectedAt: { gte?: Date; lte?: Date } = {};
  if (materialSelectedFrom) materialSelectedAt.gte = materialSelectedFrom;
  if (materialSelectedTo) materialSelectedAt.lte = materialSelectedTo;
  if (materialSelectedAt.gte || materialSelectedAt.lte) materialActiveAnd.push({ selectedAt: materialSelectedAt });
  const materialActiveWhere = materialActiveAnd.length > 1 ? { AND: materialActiveAnd } : materialActiveBaseWhere;
  const materialEventWhere =
    typeof scopeInfo.authUserId === "number"
      ? {
          userId: scopeInfo.authUserId,
          ...(materialEventAction === "all" ? {} : { action: materialEventAction }),
        }
      : {};
  const materialAssetDetail =
    includeMaterialDetail && typeof scopeInfo.authUserId === "number"
      ? await Promise.all([
          prisma.materialAsset.count({
            where: materialActiveWhere,
          }),
          Promise.resolve(0), // Legacy archive response shape; all selections now live in current.
          prisma.materialAsset.groupBy({
            by: ["category"],
            where: materialActiveBaseWhere,
            _count: { _all: true },
            orderBy: { category: "asc" },
          }),
          prisma.materialAsset.findMany({
            where: materialActiveWhere,
            orderBy: [{ selectedAt: "desc" }, { id: "desc" }],
            skip: (materialPage - 1) * materialPageSize,
            take: materialPageSize,
            include: {
              selectedByUser: { select: { id: true, username: true } },
              _count: { select: { downloads: true } }
            }
          }),
          Promise.resolve([]),
          prisma.materialAssetSelectionEvent.count({ where: { userId: scopeInfo.authUserId } }),
          prisma.materialAssetSelectionEvent.groupBy({
            by: ["action"],
            where: { userId: scopeInfo.authUserId },
            _count: { _all: true },
          }),
          includeMaterialEvents
            ? prisma.materialAssetSelectionEvent.findMany({
                where: materialEventWhere,
                orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
                skip: (materialEventPage - 1) * materialEventPageSize,
                take: materialEventPageSize,
                include: {
                  asset: {
                    select: {
                      id: true,
                      category: true,
                      title: true,
                      imageUrl: true,
                      thumbnailUrl: true,
                      previewUrl: true,
                      mimeType: true,
                      sizeBytes: true,
                      mediaCount: true,
                      selectedMediaId: true,
                      creatorName: true,
                      isDeleted: true,
                      selectedByUserId: true,
                      selectedByUser: { select: { id: true, username: true } },
                    },
                  },
                },
              })
            : Promise.resolve([]),
          prisma.materialAssetSelectionEvent.count({ where: materialEventWhere }),
        ]).then(([activeTotal, archivedTotal, activeCategories, activeCurrent, archivedCurrent, eventTotal, eventActionCounts, events, filteredEventTotal]) => {
          const totalPages = Math.max(1, Math.ceil(activeTotal / materialPageSize));
          const currentPage = Math.min(materialPage, totalPages);
          const archivedTotalPages = Math.max(1, Math.ceil(archivedTotal / materialArchivedPageSize));
          const archivedCurrentPage = Math.min(materialArchivedPage, archivedTotalPages);
          const eventTotalPages = Math.max(1, Math.ceil(filteredEventTotal / materialEventPageSize));
          const eventCurrentPage = Math.min(materialEventPage, eventTotalPages);
          const eventCountByAction = Object.fromEntries(
            (eventActionCounts as Array<{ action: string | null; _count?: { _all?: number } }>).map((row) => [
              row.action || "",
              Number(row._count?._all || 0),
            ])
          );
          const stats = {
            currentSelected: activeTotal,
            selects: eventCountByAction.select || 0,
            cancelRequests: eventCountByAction.cancel_request || 0,
            releases: eventCountByAction.release || 0,
            archived: archivedTotal,
            eventTotal,
          };
          return {
            current: activeCurrent.map(serializeMaterialAssetLite),
            archived: archivedCurrent.map(serializeMaterialAssetLite),
            events: events.map(serializeMaterialAssetEvent),
            categories: (activeCategories as Array<{ category: string | null; _count?: { _all?: number } }>).map((row) => ({
              key: row.category?.trim() || "__uncategorized",
              label: row.category?.trim() || "未分类",
              count: Number(row._count?._all || 0),
            })),
            stats,
            pagination: {
              page: currentPage,
              pageSize: materialPageSize,
              total: activeTotal,
              totalPages,
              hasMore: currentPage * materialPageSize < activeTotal,
            },
            archivedPagination: {
              page: archivedCurrentPage,
              pageSize: materialArchivedPageSize,
              total: archivedTotal,
              totalPages: archivedTotalPages,
              hasMore: archivedCurrentPage * materialArchivedPageSize < archivedTotal,
              loaded: includeArchivedMaterials,
            },
            eventsPagination: {
              page: eventCurrentPage,
              pageSize: materialEventPageSize,
              total: filteredEventTotal,
              totalPages: eventTotalPages,
              hasMore: eventCurrentPage * materialEventPageSize < filteredEventTotal,
              loaded: includeMaterialEvents,
              action: materialEventAction,
              allTotal: eventTotal,
            },
          };
        }).catch(() => ({
          current: [],
          archived: [],
          events: [],
          stats: { currentSelected: 0, selects: 0, cancelRequests: 0, releases: 0, archived: 0, eventTotal: 0 },
          eventsPagination: { page: 1, pageSize: materialEventPageSize, total: 0, totalPages: 1, hasMore: false, loaded: false, action: materialEventAction, allTotal: 0 },
        }))
      : {
          current: [],
          archived: [],
          events: [],
          stats: { currentSelected: 0, selects: 0, cancelRequests: 0, releases: 0, archived: 0, eventTotal: 0 },
          pagination: { page: 1, pageSize: materialPageSize, total: 0, totalPages: 1, hasMore: false },
          archivedPagination: { page: 1, pageSize: materialArchivedPageSize, total: 0, totalPages: 1, hasMore: false, loaded: false },
          eventsPagination: { page: 1, pageSize: materialEventPageSize, total: 0, totalPages: 1, hasMore: false, loaded: false, action: materialEventAction, allTotal: 0 },
        };

  return NextResponse.json({
    analysisDetailsIncluded: includeAnalysisDetails,
    userId,
    authUserId: scopeInfo.authUserId,
    linkedUserIds: scopeInfo.linkedUserIds,
    account: {
      requestedUserId: scopeInfo.requestedUserId,
      authUserId: scopeInfo.authUserId,
      username: authUser?.username ?? null,
      registeredAt: toIso(authUser?.createdAt),
      updatedAt: toIso(authUser?.updatedAt),
      linkedUserIds: scopeInfo.linkedUserIds,
      deviceCount: scopeInfo.linkedUserIds.length || 1,
      firstGenerationAt,
      lastGenerationAt,
      lastFinishedAt,
      activeDays,
      totalGenerationRecords,
      generatedRecords: Math.max(0, totalGenerationRecords - importCount),
      importRecords: importCount,
      logRecords: totalLogs,
      feedbackRecords: totalFeedbacks,
      privateLibraryItems: Number(mediaLibraryStats?._count?._all || 0),
      privateLibraryBytes: Number(mediaLibraryStats?._sum?.sizeBytes || 0),
      billingRecords: billingRecordCount,
      billingAmount,
      agentConversations: Number(agentConversationTotal || 0),
      agentMessages: Number(agentMessageTotal || 0),
      agentRuns: agentRunCount,
      agentInputTokens: Number(agentRunTotal?._sum?.inputTokens || 0),
      agentOutputTokens: Number(agentRunTotal?._sum?.outputTokens || 0),
      agentAvgLatencyMs: Math.round(Number(agentRunTotal?._avg?.latencyMs || 0)),
      activeMemories: Number(activeMemoryTotal || 0),
      totalMemories: Number(memoryTotal || 0),
    },
    counts: {
      byType: Object.fromEntries(byType.map((x) => [x.type, x._count._all] as const)),
      byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all] as const))
    },
    analytics: {
      bySource: Object.fromEntries(bySource.map((x) => [x.source, x._count._all] as const)),
      byModel: byModelMap,
      modelFailurePeriods,
      preferenceFlows,
      params: paramStats,
      totals: {
        uploads: includeGenerationDetails ? uploadedMaterialSet.size : importCount,
        outputs: generatedSuccessCount,
        failed: failedCount,
        successRate
      },
      logs: {
        total: totalLogs,
        byCategory: Object.fromEntries(logsByCategory.map((x) => [x.category || "--", x._count._all] as const)),
        byLevel: Object.fromEntries(logsByLevel.map((x) => [x.level || "--", x._count._all] as const)),
        dailyByCategory: logDailyByCategory,
      },
      billing: {
        trendPeriods: await billingTrendPromise,
        totalRecords: billingRecordCount,
        totalAmount: billingAmount,
        currency: "CNY",
        byCostStatus: Object.fromEntries(billingByStatus.map((x) => [x.costStatus || "--", x._count._all] as const)),
        amountByCostStatus: Object.fromEntries(billingByStatus.map((x) => [x.costStatus || "--", Number(x._sum?.amount || 0)] as const)),
        byModule: Object.fromEntries(billingByModule.map((x) => [x.module || "--", x._count._all] as const)),
        amountByModule: Object.fromEntries(billingByModule.map((x) => [x.module || "--", Number(x._sum?.amount || 0)] as const)),
      },
      agent: {
        totalConversations: Number(agentConversationTotal || 0),
        totalMessages: Number(agentMessageTotal || 0),
        totalRuns: agentRunCount,
        totalMemories: Number(memoryTotal || 0),
        activeMemories: Number(activeMemoryTotal || 0),
        inputTokens: Number(agentRunTotal?._sum?.inputTokens || 0),
        outputTokens: Number(agentRunTotal?._sum?.outputTokens || 0),
        avgLatencyMs: Math.round(Number(agentRunTotal?._avg?.latencyMs || 0)),
        conversationsByStatus: Object.fromEntries(agentConversationsByStatus.map((x) => [x.status || "--", x._count._all] as const)),
        runsByStatus: Object.fromEntries(agentRunsByStatus.map((x) => [x.status || "--", x._count._all] as const)),
        runsByModel: Object.fromEntries(agentRunsByModel.map((x) => [x.model || "--", x._count._all] as const)),
        runsByPurpose: Object.fromEntries(agentRunsByPurpose.map((x) => [x.purpose || "--", x._count._all] as const)),
      },
      daily14,
      recentActivities: recentLogs.map((l) => ({
        id: l.id,
        category: l.category,
        action: l.action,
        level: l.level,
        message: l.message,
        createdAt: l.createdAt,
        metadata: parseJson(l.metadata)
      }))
    },
    files: {
      totalReferenced: totalReferencedFiles,
      totalBytes
    },
    storage,
    materialAssets: materialAssetDetail,
    pagination: {
      page,
      pageSize,
      total: listTotal,
      totalPages,
      hasMore: page < totalPages,
      kind: kind === "import" || kind === "generated" ? kind : "all"
    },
    generations: generations.map((g) => {
      const key = String(g.externalTaskId || "").trim() ? `${g.type}:${String(g.externalTaskId || "").trim()}` : `id:${g.id}`;
      const inspirationTemplate = (groupedGenerationIds.get(key) || [g.id])
        .map((id) => inspirationTemplatesByGenerationId.get(id))
        .find(Boolean);
      return {
        ...g,
        params: groupedParams.get(key) || paramsByGeneration.get(g.id) || null,
        inputMaterials: groupedInputMaterials.get(key) || extractInputMaterials(paramsByGeneration.get(g.id) ?? null, g),
        outputPaths: groupedOutputPaths.get(key) || extractOutputPaths(paramsByGeneration.get(g.id) ?? null, g.localPath),
        inspirationTemplateId: inspirationTemplate?.templateId || null,
        inspirationSourceGenerationId: inspirationTemplate?.sourceGenerationId || null,
      };
    }),
    feedbacks: feedbackLogs.map((l) => {
      const meta = parseJson(l.metadata) || {};
      return {
        id: l.id,
        createdAt: l.createdAt,
        level: l.level,
        userId: l.userId,
        feedbackType: String(meta.feedbackType || "").trim() || "bug",
        content: String(meta.content || l.message || "").trim(),
        attachments: Array.isArray(meta.attachments) ? meta.attachments.map((x: any) => String(x || "").trim()).filter(Boolean) : [],
        username: String(meta.username || "").trim() || null,
      };
    }),
    presets: promptPresetDetail.presets,
    presetDeletedCount: promptPresetDetail.deletedCount,
    roleSkills,
  }, { headers: { "Cache-Control": "no-store" } });
}
