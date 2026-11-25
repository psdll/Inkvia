import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { APIMART_SEEDREAM_55_MODEL, readSeedream55Outputs, seedream55PixelTier } from "@/lib/apimart-seedream-55";
import sharp from "sharp";
import { resolvePublicPath } from "@/lib/public-path";
import { isSunoModel, parseSunoTask, type SunoTrack } from "@/lib/suno-models";
import { getSunoTask } from "@/lib/suno";
import { readGenerationImageOutputs, removeGenerationImageOutputs } from "./agent-output-recovery";
import type { AgentOutputRecovery } from "./agent-output-observation";
import { getMediaKitSubtitleTask, parseMediaKitSubtitleTask } from "@/lib/volcengine-mediakit";
import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_TIMEOUT_MS } from "@/lib/volcengine-mediakit-models";
import { isQwenImage3Model } from "@/lib/qwen-image-3-models";
import { bailianGetQwenImageTask, parseBailianQwenImageTask } from "@/lib/bailian-qwen-image";
// 统一的生成任务收尾入口。
//
// 所有"查 provider → 保存结果 → 去重 → 计费"只允许经过 finalizeGeneration(id)：
// 后台 worker、/api/history 兜底等触发器只负责调用它，自己不做保存。
//
// 幂等设计：
//   - claim 由数据库字段和 updatedAt 乐观并发版本保护，抢占为 processing；
//   - 输出文件以内容 sha256 命名（saveRemoteFileWithHash），重试落到同一文件；
//   - templateData.savedOutputs 记录每个 outputIndex 的保存结果，重试时跳过已保存项；
//   - 额外 Generation 记录创建前按 (externalTaskId 组, localPath) 查重。
//
// templateData 新增字段（非破坏）：
//   phase: "generating" | "saving" | "ready" | "failed"
//   remotePreviewUrls: string[]   — provider 完成时立即写入，前端抢先展示
//   savedOutputs: [{ outputIndex, remoteUrl, localPath, hash, generationId? }]
//   finalize: { attempt, claimedAt, remoteDoneAt, savedAt, claimToken } — claimToken 仅用于诊断，updatedAt 才是所有权版本

import prisma from "@/lib/prisma";
import { kieGetTaskDetail } from "@/lib/kie";
import { extractSeedanceLastFrameUrl, seedanceGetTask } from "@/lib/seedance";
import { apimartGetTask, extractApimartImageUrls } from "@/lib/apimart-image";
import { extractApimartLastFrameUrl, extractApimartVideoUrls } from "@/lib/apimart-video";
import { APIMART_SEEDANCE_25_MODEL_ID } from "@/lib/sora2";
import { extractReapiImageUrls, reapiGetImageTask } from "@/lib/reapi-image";
import { aicomingHaiyaGetImageTask, extractAicomingImageUrls } from "@/lib/aicoming-image";
import { miniMaxGetVideoTask } from "@/lib/minimax-video";
import { wanGetVideoTask } from "@/lib/wan-video";
import { saveRemoteFileWithHash } from "@/lib/storage";
import { generationOutputFolder } from "@/lib/generation/output-folder";
import { Logger } from "@/lib/logger";
import { formatFriendlyMessageForStorage, toFriendlyError, unknownFriendlyErrorLogMeta } from "@/lib/error-friendly";
import { upsertUsageLedgerForGenerationId } from "@/lib/billing-ledger";
import { createGenerationDisplayAssetPatch } from "@/lib/generation-display-assets";
import { withGenerationDebug } from "@/lib/creative-agent/debug-generation";
import { upsertAdminAssetFeedForGenerationId } from "@/lib/admin-asset-feed";
import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { providerFailureText } from "@/lib/providers/failure-capture";
import {
  bindGenerationChildToClaim,
  createGenerationClaimLease,
  createGenerationClaimTemplateData,
  GenerationClaimLostError,
  generationClaimOwnerWhere,
  generationClaimTokenNeedle,
  ownsGenerationClaim,
  releaseGenerationClaim,
  runGenerationClaimWrite,
  terminalizeGenerationClaim,
  type GenerationClaimLease,
  withGenerationClaimHeartbeat,
} from "@/lib/generation/claim-lease";

import { workFisherGetImageTask, parseWorkFisherImageTask } from "@/lib/work-fisher-image";

export const FINALIZE_PROVIDERS = [MEDIAKIT_PROVIDER, "work-fisher", "kie", "volcengine", "apimart", "reapi", "aicoming", "aicoming-haiya", "minimax", "bailian"] as const;

export const FINALIZE_IN_PROGRESS_STATUSES = ["running", "queued", "pending", "submitted"];

// 任务整体超时：超过该时长仍未完成则标记失败（沿用原 history 同步的 30 分钟口径）
export const FINALIZE_MAX_AGE_MS = 30 * 60 * 1000;
export const IMAGE_EDIT_FINALIZE_MAX_AGE_MS = 15 * 60 * 1000;
export const REAPI_FIRST_POLL_DELAY_MS = 2 * 1000;
export const FINALIZE_EMPTY_RESULT_MAX_ATTEMPTS = 3;

export type FinalizeResult = "done" | "failed" | "pending" | "skipped";
export type FinalizeErrorClass = "transient" | "terminal";

export function classifyFinalizeError(error: unknown): FinalizeErrorClass {
  const value = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  } | null;
  const status = Number(value?.status ?? value?.statusCode ?? value?.response?.status);
  const message = String(value?.message || error || "");
  if (
    [400, 401, 403, 404, 405, 409, 410, 413, 415, 422].includes(status)
    || /\b(?:400|401|403|404|405|409|410|413|415|422)\b|unauthorized|forbidden|access permissions|permission|input should|literal_error|validation|unprocessable|invalid (?:input|parameter)|not[\s_-]?found|task[\s_-]?not[\s_-]?exist/i.test(message)
  ) {
    return "terminal";
  }
  return "transient";
}

export function finalizeRetryDelayMs(attempt: number) {
  const normalized = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(30_000, 2_000 * (2 ** (normalized - 1)));
}

export type SavedOutput = {
  suno?: SunoTrack;
  outputIndex: number;
  providerOutputIndex?: number;
  remoteUrl: string;
  localPath: string;
  hash: string;
  generationId?: number;
};

export function isInProgressStatus(status: string) {
  const v = (status || "").toLowerCase();
  return v === "running" || v === "queued" || v === "pending" || v === "processing" || v === "submitted";
}

function getFinalizeMaxAgeMs(item: any) {
  if (item?.externalProvider === MEDIAKIT_PROVIDER) return MEDIAKIT_SUBTITLE_TIMEOUT_MS;
  return String(item?.type || "") === "image_edit" ? IMAGE_EDIT_FINALIZE_MAX_AGE_MS : FINALIZE_MAX_AGE_MS;
}

function parseMetadata(text: string | null | undefined): Record<string, any> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mergeTemplateData(raw: string | null | undefined, patch: Record<string, any>) {
  return JSON.stringify({ ...parseMetadata(raw), ...patch });
}

function canonicalUrlForDedupe(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const u = new URL(text);
    return `${u.origin}${u.pathname}`;
  } catch {
    return text;
  }
}

export function dedupeUrls(urls: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = canonicalUrlForDedupe(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}



export function extractResultUrls(resultJson: string | null) {
  if (!resultJson) return [] as string[];
  try {
    const parsed = JSON.parse(resultJson);
    const maybeArrays = [
      parsed?.resultUrls,
      parsed?.data?.resultUrls,
      parsed?.result_urls,
      parsed?.data?.result_urls,
      parsed?.video_urls,
      parsed?.data?.video_urls
    ] as any[];
    for (const urls of maybeArrays) {
      if (!Array.isArray(urls)) continue;
      const out: string[] = [];
      for (const x of urls) {
        if (typeof x === "string" && x.length > 0) out.push(x);
        else if (x && typeof x === "object") {
          const u = (x as any).resultUrl || (x as any).url || (x as any).videoUrl || (x as any).video_url;
          if (typeof u === "string" && u.length > 0) out.push(u);
        }
      }
      if (out.length) return dedupeUrls(out);
    }
    const maybeSingle =
      parsed?.video_url ||
      parsed?.videoUrl ||
      parsed?.data?.video_url ||
      parsed?.data?.videoUrl ||
      parsed?.url ||
      parsed?.data?.url;
    if (typeof maybeSingle === "string" && maybeSingle.length > 0) return dedupeUrls([maybeSingle]);
  } catch (e: any) {
    console.warn("[finalize] extractResultUrls parse failed:", e?.message || e);
  }
  return [] as string[];
}

type ProviderOutcome =
  | { kind: "pending"; providerStatus: string; templatePatch?: Record<string, any> }
  | { kind: "failed"; message: string; providerStatus: string; templatePatch?: Record<string, any> }
  | {
      kind: "done";
      urls: string[];
      providerStatus: string;
      providerUsage?: any;
      templatePatch?: Record<string, any>;
      lastFrameUrl?: string;
      // APIMART 可能先报告完成，稍后才返回输出；保留有界重试。
      emptyMeansWait?: boolean;
    };

async function queryProvider(item: any): Promise<ProviderOutcome> {
  const provider = String(item.externalProvider || "kie").toLowerCase();
  const taskId = String(item.externalTaskId || "").trim();

  if (provider === MEDIAKIT_PROVIDER) return parseMediaKitSubtitleTask(await getMediaKitSubtitleTask(taskId));

  if (provider === "bailian" && isQwenImage3Model(item.model)) return parseBailianQwenImageTask(await bailianGetQwenImageTask(taskId));

  if (provider === "work-fisher") return parseWorkFisherImageTask(await workFisherGetImageTask(taskId));

  if (provider === "apimart" && isSunoModel(item.model)) return parseSunoTask(await getSunoTask(taskId));

  if (provider === "apimart") {
    const detail = await apimartGetTask(taskId);
    const data = (detail as any)?.data || detail;
    const state = String(data?.status || "").toLowerCase();
    if (state === "completed") {
      const isVideoTask = item.type === "video_gen" || item.type === "video_generate";
      const seedream55Outputs = item.model === APIMART_SEEDREAM_55_MODEL ? readSeedream55Outputs(data) : null;
      const urls = seedream55Outputs ? seedream55Outputs.map(output => output.url) : dedupeUrls(isVideoTask ? extractApimartVideoUrls(detail) : extractApimartImageUrls(detail));
      // APIMart may publish the result before its token settlement is ready.
      // Allow three more polls, then keep the result with missing usage for reconciliation.
      const usage = data?.usage ?? data?.result?.usage ?? null;
      if (item.model === APIMART_SEEDANCE_25_MODEL_ID && urls.length && !(Number(usage?.completion_tokens) > 0)) {
        const waits = Number(parseMetadata(item.templateData).apimartUsageWaitAttempts || 0);
        if (waits < 3) return {
          kind: "pending", providerStatus: state,
          templatePatch: { apimartUsageWaitAttempts: waits + 1, remotePreviewUrls: urls },
        };
      }
      return {
        kind: "done",
        urls,
        providerStatus: state,
        providerUsage: {
          usage,
          input_video_duration: data?.usage?.input_video_duration ?? data?.input_video_duration ?? null,
          cost: data?.cost ?? null,
          credits_cost: data?.credits_cost ?? null,
          actual_time: data?.actual_time ?? null,
        },
        ...(seedream55Outputs ? { templatePatch: { seedream55Outputs } } : {}),
        lastFrameUrl: isVideoTask ? extractApimartLastFrameUrl(detail) || undefined : undefined,
        emptyMeansWait: urls.length === 0,
      };
    }
    if (state === "failed" || state === "cancelled" || state === "canceled") {
      // Midjourney 等任务把失败原因放在 fail_reason（如提示词被拦截、超时、无可用上游）
      const failMsg = sanitizeProviderErrorText(data?.error?.message || data?.error || data?.fail_reason || data?.result?.fail_reason || (detail as any)?.error?.message || (detail as any)?.fail_reason || "APIMart task failed");
      return {
        kind: "failed",
        message: providerFailureText({ message: failMsg, providerPayload: data?.error || (detail as any)?.error }, failMsg),
        providerStatus: state || "failed",
      };
    }
    return { kind: "pending", providerStatus: state || "submitted" };
  }

  if (provider === "reapi") {
    const detail = await reapiGetImageTask(taskId);
    const state = String((detail as any)?.status || "").toLowerCase();
    if (state === "completed" || state === "succeeded" || state === "success") {
      return {
        kind: "done",
        urls: dedupeUrls(extractReapiImageUrls(detail)),
        providerStatus: state,
        providerUsage: detail?.usage || null,
      };
    }
    if (state === "failed" || state === "cancelled" || state === "canceled" || state === "expired") {
      const failMsg = sanitizeProviderErrorText(
        (detail as any)?.error?.message || (detail as any)?.error || "reAPI task failed",
      );
      return {
        kind: "failed",
        message: providerFailureText({ message: failMsg, providerPayload: (detail as any)?.error }, failMsg),
        providerStatus: state || "failed",
      };
    }
    return { kind: "pending", providerStatus: state || "processing" };
  }

  if (provider === "aicoming-haiya") {
    const detail = await aicomingHaiyaGetImageTask(taskId);
    const state = String(
      (detail as any)?.status
      || (!Array.isArray((detail as any)?.data) ? (detail as any)?.data?.status : "")
      || "",
    ).toLowerCase();
    if (state === "completed" || state === "succeeded" || state === "success") {
      return {
        kind: "done",
        urls: dedupeUrls(extractAicomingImageUrls(detail)),
        providerStatus: state,
      };
    }
    if (state === "failed" || state === "cancelled" || state === "canceled" || state === "expired") {
      const failMsg = sanitizeProviderErrorText(
        (detail as any)?.error?.message
        || (detail as any)?.error
        || (!Array.isArray((detail as any)?.data) ? (detail as any)?.data?.error?.message : "")
        || "AIComing task failed",
      );
      return {
        kind: "failed",
        message: providerFailureText({
          message: failMsg,
          providerPayload: (detail as any)?.error || (!Array.isArray((detail as any)?.data) ? (detail as any)?.data?.error : null),
        }, failMsg),
        providerStatus: state || "failed",
      };
    }
    return { kind: "pending", providerStatus: state || "processing" };
  }

  if (provider === "bailian") {
    const detail = await wanGetVideoTask(taskId);
    const state = String(detail?.output?.task_status || "").toUpperCase();
    if (state === "SUCCEEDED") {
      const url = String(detail?.output?.video_url || "").trim();
      const duration = Number(detail?.usage?.output_video_duration ?? detail?.usage?.duration);
      return {
        kind: "done",
        urls: url ? [url] : [],
        providerStatus: state,
        providerUsage: detail?.usage || null,
        templatePatch: Number.isFinite(duration) && duration > 0 ? { duration } : {},
      };
    }
    if (["FAILED", "CANCELED", "UNKNOWN"].includes(state)) {
      return { kind: "failed", message: sanitizeProviderErrorText(detail?.output?.message || `Wan3.0 任务状态: ${state}`), providerStatus: state };
    }
    return { kind: "pending", providerStatus: state || "PENDING" };
  }

  if (provider === "minimax") {
    const detail = await miniMaxGetVideoTask(taskId);
    const task = (detail as any)?.task;
    const state = String(task?.status || "").toLowerCase();
    if (state === "succeeded") {
      const url = String(task?.content?.url || "").trim();
      return {
        kind: "done",
        urls: url ? [url] : [],
        providerStatus: state,
        providerUsage: task?.usage || null,
      };
    }
    if (state === "failed" || state === "cancelled" || state === "canceled") {
      const failMsg = sanitizeProviderErrorText(task?.error?.message || task?.error || "MiniMax task failed");
      return {
        kind: "failed",
        message: providerFailureText({ message: failMsg, providerPayload: task?.error }, failMsg),
        providerStatus: state || "failed",
      };
    }
    return { kind: "pending", providerStatus: state || "queued" };
  }

  if (provider === "volcengine") {
    const detail = await seedanceGetTask(taskId);
    const state = String((detail as any)?.status || "").toLowerCase();
    if (state === "succeeded") {
      const url = String((detail as any)?.content?.video_url || "").trim();
      return {
        kind: "done",
        urls: url ? [url] : [],
        providerStatus: state,
        providerUsage: (detail as any)?.usage || null,
        lastFrameUrl: extractSeedanceLastFrameUrl(detail as any) || undefined,
      };
    }
    if (state === "failed" || state === "cancelled" || state === "expired") {
      const failMsg = sanitizeProviderErrorText((detail as any)?.error?.message || `任务状态异常: ${state || "unknown"}`);
      return {
        kind: "failed",
        message: providerFailureText({ message: failMsg, providerPayload: (detail as any)?.error }, failMsg),
        providerStatus: state,
      };
    }
    return { kind: "pending", providerStatus: state || "running" };
  }



  // 默认 kie
  const detail = await kieGetTaskDetail(taskId);
  const state = String((detail as any)?.state || "").toLowerCase();
  if (state === "success") {
    return {
      kind: "done",
      urls: extractResultUrls((detail as any).resultJson || null),
      providerStatus: state,
      providerUsage: (detail as any)?.usage || null,
    };
  }
  if (state === "fail") {
    const failMsg = sanitizeProviderErrorText((detail as any).failMsg || "生成失败");
    return {
      kind: "failed",
      message: providerFailureText({
        message: failMsg,
        providerPayload: {
          code: (detail as any)?.errorCode || null,
          message: (detail as any)?.failMsg || null,
          state,
        },
      }, failMsg),
      providerStatus: state,
    };
  }
  return { kind: "pending", providerStatus: state || "running" };
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

async function updateGenerationTemplateData(lease: GenerationClaimLease, patch: Record<string, any>) {
  const id = lease.id;
  return runGenerationClaimWrite(lease, async (revision, next) => {
    const latest = await prisma.generation.findUnique({
      where: { id },
      select: { templateData: true, updatedAt: true },
    });
    if (!latest
      || latest.updatedAt.getTime() !== revision.getTime()
      || !String(latest.templateData || "").includes(generationClaimTokenNeedle(lease.token))) {
      throw new GenerationClaimLostError();
    }
    const templateData = mergeTemplateData(latest.templateData, patch);
    const updated = await prisma.generation.updateMany({
      where: {
        ...generationClaimOwnerWhere(lease, revision),
        templateData: latest.templateData,
      } as any,
      data: { templateData, updatedAt: next },
    });
    if (!updated.count) throw new GenerationClaimLostError();
    return templateData;
  });
}

async function updateClaimedGeneration(
  lease: GenerationClaimLease,
  expectedTemplateData: string | null,
  data: Record<string, any>,
) {
  return runGenerationClaimWrite(lease, async (revision, next) => {
    const updated = await prisma.generation.updateMany({
      where: {
        ...generationClaimOwnerWhere(lease, revision),
        templateData: expectedTemplateData,
      } as any,
      data: { ...data, updatedAt: next } as any,
    });
    if (!updated.count) throw new GenerationClaimLostError();
    return updated;
  });
}

async function markFailed(
  item: any,
  lease: GenerationClaimLease,
  message: string,
  providerStatus: string,
  templatePatch?: Record<string, any>,
): Promise<FinalizeResult> {
  let latestItem: any;
  try {
    latestItem = await prisma.generation.findUnique({
      where: { id: item.id },
      include: { authUser: { select: { username: true } } },
    });
  } catch {
    await releaseClaim(item, lease);
    return "pending";
  }
  if (!ownsGenerationClaim(latestItem, lease)) {
    return "skipped";
  }
  const safeMessage = sanitizeProviderErrorText(message, [], "生成失败");
  const friendly = toFriendlyError(safeMessage);
  const ruleMissMeta = unknownFriendlyErrorLogMeta(friendly, {
    provider: latestItem.externalProvider || null,
    model: latestItem.model || null,
    status: providerStatus || null
  });
  const storageMessage =
    providerStatus === "timeout" && String(latestItem.type || "") === "image_edit"
      ? "任务超时，请重试"
      : formatFriendlyMessageForStorage(friendly);
  const finishedAt = new Date();
  const failedTemplateData = mergeTemplateData(latestItem.templateData || null, {
    ...(templatePatch || {}),
    providerStatus,
    phase: "failed",
  });
  const terminalFailure = {
    ...latestItem,
    status: "failed",
    errorMsg: storageMessage,
    finishedAt,
    updatedAt: finishedAt,
    ...(String(latestItem.externalTaskId || "").trim() ? { externalTaskId: String(latestItem.externalTaskId).trim() } : {}),
    templateData: failedTemplateData,
  };
  try {
    await terminalizeGenerationClaim(lease, {
      status: "failed",
      errorMsg: storageMessage,
      finishedAt,
      ...(String(latestItem.externalTaskId || "").trim() ? { externalTaskId: String(latestItem.externalTaskId).trim() } : {}),
      templateData: failedTemplateData,
    }, terminalFailure);
  } catch (error) {
    if (error instanceof GenerationClaimLostError) return "skipped";
    await releaseClaim(latestItem, lease);
    return "pending";
  }
  if (ruleMissMeta) {
    await Logger.generation(
      "friendly_error_rule_miss",
      `待补错误规则: ${ruleMissMeta.summary || "未知错误"}`,
      "warning",
      item.id,
      ruleMissMeta,
      String(item.userId || "")
    );
  }
  await Logger.generation(
    "task_failed",
    `任务 ${item.id} (${item.type}) 失败: ${safeMessage}`,
    "error",
    item.id,
    {
      type: item.type,
      error: safeMessage,
      externalTaskId: String(item.externalTaskId || "") || null,
      providerState: providerStatus,
    },
    String(item.userId || "")
  );
  return "failed";
}

// 释放 claim：回到 running 等待下一次触发
async function releaseClaim(item: any, lease: GenerationClaimLease, templatePatch?: Record<string, any>) {
  let latest: { templateData: string | null; updatedAt: Date } | null = null;
  if (templatePatch) {
    try {
      latest = await prisma.generation.findUnique({ where: { id: item.id }, select: { templateData: true, updatedAt: true } });
    } catch {
      return false;
    }
    if (!latest
      || latest.updatedAt.getTime() !== lease.revision.getTime()
      || !String(latest.templateData || "").includes(generationClaimTokenNeedle(lease.token))) return false;
  }
  try {
    if (templatePatch) {
      await runGenerationClaimWrite(lease, async (revision, next) => {
        const released = await prisma.generation.updateMany({
          where: { ...generationClaimOwnerWhere(lease, revision), templateData: latest!.templateData } as any,
          data: {
            status: "running",
            errorMsg: null,
            finishedAt: null,
            templateData: mergeTemplateData(latest!.templateData, templatePatch),
            updatedAt: next,
          } as any,
        });
        if (!released.count) throw new GenerationClaimLostError();
        return true;
      });
    } else {
      await releaseGenerationClaim(lease, {
      status: "running",
      errorMsg: null,
      finishedAt: null,
      });
    }
  } catch {
    return false;
  }
  await upsertAdminAssetFeedForGenerationId(item.id).catch(() => null);
  return true;
}

/**
 * 统一收尾入口。返回值：
 *   done    — 本次完成保存（status=success）
 *   failed  — 任务失败（status=failed）
 *   pending — provider 还没完成 / 瞬时错误已释放等待重试
 *   skipped — 无需处理（已完成 / 被其他触发器抢占 / 不支持的 provider）
 */
export async function finalizeGeneration(generationId: number): Promise<FinalizeResult> {
  const id = Number(generationId);
  if (!Number.isFinite(id) || id <= 0) return "skipped";

  const preClaimItem: any = await prisma.generation.findUnique({
    where: { id },
    include: { authUser: { select: { username: true } } },
  });
  if (!preClaimItem || preClaimItem.localPath || !isInProgressStatus(String(preClaimItem.status || ""))) return "skipped";

  return withGenerationDebug(preClaimItem, async () => {

  const hasRecovery = Boolean(parseMetadata(preClaimItem.templateData || null).agentOutputRecovery?.key);
  let provider = String(preClaimItem.externalProvider || "kie").toLowerCase();
  let providerHasPollingAdapter = FINALIZE_PROVIDERS.includes(provider as any);
  let taskId = String(preClaimItem.externalTaskId || "").trim();
  const preClaimAgeMs = Math.max(0, Date.now() - new Date(preClaimItem.createdAt).getTime());
  const preClaimMaxAgeMs = getFinalizeMaxAgeMs(preClaimItem);
  if (!hasRecovery && provider === "reapi" && preClaimAgeMs < REAPI_FIRST_POLL_DELAY_MS) return "skipped";
  const missingTaskId = !taskId;
  // An uncertain Suno submission must never become a retryable failed request.
  if (isSunoModel(preClaimItem.model) && missingTaskId) return "skipped";
  const synchronousVolcengineImage = provider === "volcengine"
    && preClaimItem.type !== "video_gen"
    && preClaimItem.type !== "video_generate";
  // 等待提交链路写回任务 ID，超时后进入 claim 并明确失败。
  if (!hasRecovery && (!providerHasPollingAdapter || missingTaskId || synchronousVolcengineImage)
    && preClaimAgeMs <= preClaimMaxAgeMs) return "skipped";

  // Doubao-Seedream 图片走火山同步接口，没有真实任务 ID（externalTaskId 是本地记录 id），
  // 结果由 image-service 进程内收尾；这里拿它查 seedanceGetTask 必然 404 → 会被误标失败。
  // 故 volcengine 只收尾视频任务，图片任务仅保留上方的超时兜底（清理进程重启留下的孤儿记录）。

  // 原子 claim：只依赖数据库字段，不在 JSON 上做锁
  if (!FINALIZE_IN_PROGRESS_STATUSES.includes(String(preClaimItem.status || ""))) return "skipped";
  if (!(preClaimItem.updatedAt instanceof Date)) return "skipped";
  const claimMetadata = createGenerationClaimTemplateData(preClaimItem.templateData || null);
  const claimRevision = new Date(Math.max(Date.now(), preClaimItem.updatedAt.getTime() + 1));
  const claim = await prisma.generation.updateMany({
    where: {
      id,
      localPath: null,
      status: { in: FINALIZE_IN_PROGRESS_STATUSES },
      templateData: preClaimItem.templateData ?? null,
      updatedAt: preClaimItem.updatedAt,
    } as any,
    data: {
      status: "processing",
      errorMsg: null,
      templateData: claimMetadata.templateData,
      updatedAt: claimRevision,
    } as any,
  });
  if (!claim.count) return "skipped";

  const lease = createGenerationClaimLease(id, claimMetadata.token, claimRevision);
  let item: any;
  try {
    item = await prisma.generation.findUnique({
      where: { id },
      include: { authUser: { select: { username: true } } },
    });
  } catch {
    await releaseClaim(preClaimItem, lease);
    return "pending";
  }
  if (!ownsGenerationClaim(item, lease)) return "skipped";
  provider = String(item.externalProvider || "kie").toLowerCase();
  providerHasPollingAdapter = FINALIZE_PROVIDERS.includes(provider as any);
  taskId = String(item.externalTaskId || "").trim();

  // processing is never reclaimed by createdAt timeout; only a fresh active-state claim reaches here.
  const ageMs = Math.max(0, Date.now() - new Date(item.createdAt).getTime());
  const maxAgeMs = getFinalizeMaxAgeMs(item);
  const meta = parseMetadata(item.templateData || null);
  const hasSavedOutputs = Array.isArray(meta.savedOutputs) && meta.savedOutputs.length > 0;

  if (!hasRecovery && !providerHasPollingAdapter) {
    return markFailed(item, lease, "No polling adapter was available before timeout", "unsupported_provider_timeout");
  }
  if (!hasRecovery && !taskId) {
    return markFailed(item, lease, "Provider task id was not recorded before timeout", "missing_task_id");
  }
  if (!hasRecovery && provider === "volcengine" && item.type !== "video_gen" && item.type !== "video_generate") {
    return markFailed(item, lease, "Local image generation did not finish before timeout", "local_finalize_timeout");
  }

  const finalizeMeta = (meta.finalize && typeof meta.finalize === "object" ? meta.finalize : {}) as Record<string, any>;
  const attempt = Number(finalizeMeta.attempt || 0) + 1;
  const claimedAt = new Date().toISOString();
  let finalWritesStarted = false;
  let parentTerminalWritten = false;

  try {
    const recovery = hasRecovery ? structuredClone(meta.agentOutputRecovery) as AgentOutputRecovery : undefined;
    const outcome: ProviderOutcome = recovery?.key
      ? { kind: "done" as const, urls: await readGenerationImageOutputs(id, recovery.key), providerStatus: "success", providerUsage: meta.providerUsage }
      : await withGenerationClaimHeartbeat(lease, () => queryProvider(item));

    if (outcome.kind === "pending") {
      if (ageMs > maxAgeMs && !hasSavedOutputs && !isSunoModel(item.model)) {
        return markFailed(item, lease, "任务超时，请重试", "timeout", outcome.templatePatch);
      }
      await releaseClaim(item, lease, {
        ...(outcome.templatePatch || {}),
        providerStatus: outcome.providerStatus,
        phase: "generating",
        finalize: { ...finalizeMeta, attempt, claimedAt },
      });
      return "pending";
    }

    if (outcome.kind === "failed") {
      return markFailed(item, lease, outcome.message, outcome.providerStatus, outcome.templatePatch);
    }

    // done
    const finalUrls = outcome.urls;
    if (!finalUrls.length) {
      if (outcome.emptyMeansWait) {
        const emptyResultAttempts = Number(finalizeMeta.emptyResultAttempts || 0) + 1;
        const emptyResultFirstSeenAt = String(finalizeMeta.emptyResultFirstSeenAt || claimedAt);
        const emptyResultFinalize = {
          ...finalizeMeta,
          attempt,
          claimedAt,
          emptyResultAttempts,
          emptyResultFirstSeenAt,
        };

        if (emptyResultAttempts >= FINALIZE_EMPTY_RESULT_MAX_ATTEMPTS || ageMs > maxAgeMs) {
          const emptyMessage = "APIMart completed but returned no output";
          return markFailed(item, lease, emptyMessage, outcome.providerStatus, {
            finalize: emptyResultFinalize,
          });
        }
        await releaseClaim(item, lease, {
          providerStatus: outcome.providerStatus,
          phase: "generating",
          finalize: emptyResultFinalize,
        });
        return "pending";
      }
      const emptyMsg =
        provider === "bailian" ? "阿里云百炼任务已完成，但未返回可用结果" : provider === "work-fisher" ? "FisherAI returned an empty result" : provider === "apimart"
          ? "APIMart returned an empty result"
          : provider === "reapi"
            ? "reAPI returned an empty result"
            : provider === "aicoming-haiya"
              ? "AIComing returned an empty result"
              : provider === "minimax"
                ? "MiniMax returned an empty result"
                : provider === "volcengine"
                  ? "Volcengine returned an empty result"
                  : "Kie returned an empty result";
      return markFailed(item, lease, emptyMsg, outcome.providerStatus, outcome.templatePatch);
    }

    const effectiveTaskId = taskId;
    const remoteDoneAt = new Date().toISOString();
    const remotePreviewUrls = recovery ? [] : finalUrls.filter(isHttpUrl);

    // 第一步：立刻写远程预览 + phase=saving，让前端在下一个轮询周期就能看到结果
    const savingTemplateData = mergeTemplateData(item.templateData || null, {
      ...(outcome.templatePatch || {}),
      providerStatus: outcome.providerStatus,
      providerUsage: outcome.providerUsage ?? meta.providerUsage ?? null,
      usageCapture: { state: outcome.providerUsage != null || meta.providerUsage != null ? "received" : "missing", providerCompleted: true, capturedAt: remoteDoneAt },
      phase: "saving",
      remotePreviewUrls,
      ...(meta.agentOutputContract?.version === 2 ? {agentOutputObservation:{rawCandidates:finalUrls.length,...(item.type === "video_gen" ? (Number.isSafeInteger((outcome.providerUsage as any)?.video_count) ? {rawReturned:Number((outcome.providerUsage as any).video_count)} : {}) : {rawReturned:meta.agentOutputObservation?.rawReturned ?? finalUrls.length}),uniqueOutputs:0,savedOutputs:0}} : {}),
      finalize: { ...finalizeMeta, attempt, claimedAt, remoteDoneAt },
    });
    await updateClaimedGeneration(lease, item.templateData || null, {
        templateData: savingTemplateData,
        ...(effectiveTaskId ? { externalTaskId: effectiveTaskId } : {}),
    });
    item.templateData = savingTemplateData;

    // 第二步：逐个输出落盘（hash 命名 + savedOutputs 账本，重试可续）
    const outputFolder = generationOutputFolder(item.type, item.source);
    const savedOutputs: SavedOutput[] = Array.isArray(meta.savedOutputs) ? [...meta.savedOutputs] : [];
    const seenHashes = new Set<string>(savedOutputs.map((o) => String(o.hash || "")).filter(Boolean));

    let pendingSaves = false;
    for (let i = 0; i < finalUrls.length; i++) {
      if (savedOutputs.some((o) => o.outputIndex === i) || recovery?.items[i]?.state === "saved") continue;
      const url = String(finalUrls[i] || "").trim();
      if (!url) continue;
      try {
        const saved = await withGenerationClaimHeartbeat(lease, () =>
          saveRemoteFileWithHash(url, outputFolder, /^data:/i.test(url), { providerId: provider }),
        );
        if (isSunoModel(item.model) || isSeedream55Model(item.model) || !seenHashes.has(saved.hash)) {
          seenHashes.add(saved.hash);
          const track: SunoTrack | undefined = isSunoModel(item.model) ? (outcome.templatePatch?.sunoTracks || meta.sunoTracks)?.[i] : undefined;
          let suno = track ? { ...track, taskId: effectiveTaskId } : undefined;
          if (suno?.coverUrl) {
            const cover = await withGenerationClaimHeartbeat(lease, () => saveRemoteFileWithHash(suno!.coverUrl!, outputFolder, false, { providerId: provider }));
            suno = { ...suno, coverUrl: cover.localPath };
          }
          savedOutputs.push({ ...(suno ? { suno, providerOutputIndex: suno.audioIndex } : {}), outputIndex: i, ...(meta.midjourneyV8 ? { providerOutputIndex: i + 1 } : {}), remoteUrl: !recovery && isHttpUrl(url) ? url : "", localPath: saved.localPath, hash: saved.hash });
        }
        if (recovery) recovery.items[i].state = "saved";
      } catch (error) {
        if (!recovery || error instanceof GenerationClaimLostError) throw error;
        recovery.items[i].state = "failed";
        pendingSaves = true;
      }
      // Persist each item under the original finalizer lease. Errors never hide
      // later outputs or expose private source URLs in user-visible metadata.
      item.templateData = await updateGenerationTemplateData(lease, {
        savedOutputs, ...(recovery ? {agentOutputRecovery:recovery} : {}),
        ...(meta.agentOutputContract?.version === 2 ? {agentOutputObservation:{...JSON.parse(savingTemplateData).agentOutputObservation,uniqueOutputs:savedOutputs.length,savedOutputs:savedOutputs.length}} : {}),
      });
    }
    if (pendingSaves) {
      await releaseClaim(item, lease, {phase:"saving",agentOutputRecovery:recovery,finalize:{...finalizeMeta,attempt,claimedAt,lastError:"部分产物保存待恢复，不重新生成"}});
      return "pending";
    }

    savedOutputs.sort((a, b) => a.outputIndex - b.outputIndex);
    const seedream55OutputPatches: Record<number, Record<string, any>> = {};
    if (isSeedream55Model(item.model)) {
      const outputs = parseMetadata(item.templateData).seedream55Outputs || [];
      for (const output of savedOutputs) {
        const dimensions = await sharp(resolvePublicPath(output.localPath)).metadata();
        const size = `${dimensions.width}x${dimensions.height}`;
        seedream55OutputPatches[output.outputIndex] = {
          seedream55OutputIndex: output.outputIndex,
          seedream55Output: { ...outputs[output.outputIndex], size },
          seedream55PixelTier: seedream55PixelTier(size),
          imageInputCount: output.outputIndex === 0 ? Number(meta.imageInputCount || 0) : 0,
          outputCount: 1,
        };
      }
    }
    const firstOutput = savedOutputs[0];
    if (!firstOutput) {
      const emptyMsg =
        provider === "apimart"
          ? "APIMart result save failed"
          : provider === "reapi"
            ? "reAPI result save failed"
            : provider === "aicoming-haiya"
              ? "AIComing result save failed"
              : provider === "minimax"
                ? "MiniMax result save failed"
                : provider === "volcengine"
                  ? "Volcengine returned an empty result"
                  : "Result save failed";
      return markFailed(item, lease, emptyMsg, outcome.providerStatus);
    }

    // 尾帧图（volcengine 视频）
    let lastFramePath = "";
    if (outcome.lastFrameUrl) {
      try {
        lastFramePath = (
          await withGenerationClaimHeartbeat(lease, () => {
            if (!outcome.lastFrameUrl) throw new Error("Missing last frame URL");
            return saveRemoteFileWithHash(
              outcome.lastFrameUrl,
              outputFolder,
              false,
              { providerId: provider },
            );
          })
        ).localPath;
      } catch (e) {
        console.warn("[finalize] save last frame failed:", e);
      }
    }

    // 第三步：多输出 → 额外 Generation 记录（幂等）。父记录仍保持 processing，
    // 这样维护模式的 active-count 不会在所有持久输出完成前归零。
    finalWritesStarted = true;
    const groupId = effectiveTaskId || String(id);
    for (const output of savedOutputs) {
      if (output === firstOutput) continue;
      const extraDisplayPatch = await withGenerationClaimHeartbeat(lease, () =>
        createGenerationDisplayAssetPatch({
          type: item.type,
          localPath: output.localPath,
          templateData: item.templateData || null,
        }).catch(() => ({})),
      );
      const childTemplateData = mergeTemplateData(item.templateData || null, {
        ...(seedream55OutputPatches[output.outputIndex] ? { ...seedream55OutputPatches[output.outputIndex], seedream55Outputs: undefined } : {}),
        phase: "ready",
        ...(output.suno ? { sunoAudioIndex: output.suno.audioIndex, durationSeconds: output.suno.durationSeconds, songTitle: output.suno.title } : {}),
        remotePreviewUrls: output.remoteUrl ? [output.remoteUrl] : [],
        savedOutputs: [{ ...output, generationId: undefined }],
        ...(meta.billing?.childBillable === false ? {
          billing: { ...meta.billing, billable: false, parentGenerationId: id },
        } : {}),
        ...extraDisplayPatch,
      });
      const bound = await bindGenerationChildToClaim(lease, {
        childWhere: {
          type: String(item.type || ""),
          externalTaskId: groupId,
          localPath: output.localPath,
          ...(isSeedream55Model(item.model) ? { templateData: { contains: `"seedream55OutputIndex":${output.outputIndex},` } } : {}),
          ...(output.suno ? { templateData: { contains: `"sunoAudioIndex":${output.suno.audioIndex},` } } : {}),
        },
        childData: {
          userId: String(item.userId || ""),
          authUserId: Number.isFinite(Number(item.authUserId)) ? Number(item.authUserId) : null,
          type: String(item.type || ""),
          source: String(item.source || "tool"),
          prompt: String(item.prompt || ""),
          templateData: childTemplateData,
          model: item.model ? String(item.model) : null,
          status: "success",
          localPath: output.localPath,
          externalProvider: item.externalProvider ? String(item.externalProvider) : null,
          externalTaskId: groupId,
          errorMsg: null,
          finishedAt: new Date(),
        },
        buildParentTemplateData: (latestTemplateData, child) => mergeTemplateData(latestTemplateData, {
          savedOutputs: savedOutputs.map((saved) => saved.outputIndex === output.outputIndex
            ? { ...saved, generationId: child.id }
            : saved),
        }),
      });
      output.generationId = bound.child.id;
      item.templateData = bound.parentTemplateData;
    }

    // 第四步：所有额外输出和 generationId 账本持久化后，最后写父记录终态。
    const displayPatch = await withGenerationClaimHeartbeat(lease, () =>
      createGenerationDisplayAssetPatch({
        type: item.type,
        localPath: firstOutput.localPath,
        templateData: item.templateData || null,
      }).catch(() => ({})),
    );
    const finishedAt = new Date();
    const savedAt = finishedAt.toISOString();
    const readyTemplateData = mergeTemplateData(savingTemplateData, {
      ...(seedream55OutputPatches[firstOutput.outputIndex] || {}),
      phase: "ready",
      ...(firstOutput.suno ? { sunoAudioIndex: firstOutput.suno.audioIndex, songTitle: firstOutput.suno.title, durationSeconds: firstOutput.suno.durationSeconds } : {}),
      savedOutputs,
      ...(recovery ? {agentOutputRecovery:{version:1,items:recovery.items}} : {}),
      ...(meta.agentOutputContract?.version === 2 ? {agentOutputObservation:{...JSON.parse(savingTemplateData).agentOutputObservation,uniqueOutputs:savedOutputs.length,savedOutputs:savedOutputs.length}} : {}),
      finalize: { ...finalizeMeta, attempt, claimedAt, remoteDoneAt, savedAt },
      ...(lastFramePath ? { lastFramePath, lastFrameUrl: outcome.lastFrameUrl } : {}),
      ...displayPatch,
    });
    const terminalParent = {
      ...item,
      status: "success",
      localPath: firstOutput.localPath,
      errorMsg: null,
      finishedAt,
      updatedAt: finishedAt,
      ...(effectiveTaskId ? { externalTaskId: effectiveTaskId } : {}),
      templateData: readyTemplateData,
    };
    try {
      await terminalizeGenerationClaim(lease, {
        status: "success",
        localPath: firstOutput.localPath,
        errorMsg: null,
        finishedAt,
        ...(effectiveTaskId ? { externalTaskId: effectiveTaskId } : {}),
        templateData: readyTemplateData,
      }, terminalParent);
    } catch (error) {
      if (error instanceof GenerationClaimLostError) return "skipped";
      throw error;
    }
    parentTerminalWritten = true;
    if (recovery?.key) await removeGenerationImageOutputs(id,recovery.key).catch(() => undefined);

    const elapsedMs = Date.now() - new Date(item.createdAt).getTime();
    await Logger.generation(
      "task_success",
      `任务 ${id} (${item.type}) 执行成功`,
      "success",
      id,
      {
        type: item.type,
        elapsedMs,
        outputPath: firstOutput.localPath,
        outputPaths: [firstOutput.localPath, lastFramePath].filter(Boolean),
        ...(lastFramePath ? { lastFramePath, lastFrameUrl: outcome.lastFrameUrl } : {}),
        externalTaskId: effectiveTaskId || null,
        returnedCount: savedOutputs.length,
      },
      String(item.userId || "")
    );
    return "done";
  } catch (e: any) {
    const msg = String(e?.message || "生成失败");
    if (parentTerminalWritten) return "done";
    if (e instanceof GenerationClaimLostError) return "skipped";
    if (hasRecovery) {
      await releaseClaim(item, lease, {phase:"saving",finalize:{...finalizeMeta,attempt,claimedAt,lastError:"产物保存待恢复，不重新生成"}});
      return "pending";
    }
    if (finalWritesStarted) {
      if (ageMs > maxAgeMs) {
        return markFailed(item, lease, msg, "persistence_timeout", {
          finalize: { ...finalizeMeta, attempt, claimedAt, lastError: msg },
        });
      }
      await releaseClaim(item, lease, {
        finalize: { ...finalizeMeta, attempt, claimedAt, lastError: msg },
        phase: "saving",
      });
      return "pending";
    }
    // 查询链路中断不能证明已提交的上游任务失败；恢复连接后继续查询原任务。
    if (classifyFinalizeError(e) === "terminal") {
      return markFailed(item, lease, msg, "sync_error");
    }

    // 瞬时错误：释放 claim 等待下次重试，attempt 累计
    await releaseClaim(item, lease, {
      finalize: { ...finalizeMeta, attempt, claimedAt, lastError: msg },
      phase: "generating",
    });
    return "pending";
  }
  });
}

// 回收卡死的 processing：claim 后进程崩溃/重启会留下 processing 记录，
// updatedAt 超过阈值说明没有 finalizer 在推进，重置回 running 可被重新认领。
const STALE_PROCESSING_MS = 3 * 60 * 1000;

export async function recoverStaleProcessingGeneration(generationId: number, staleMs = STALE_PROCESSING_MS) {
  const cutoff = new Date(Date.now() - staleMs);
  const result = await prisma.generation.updateMany({
    where: {
      id: generationId,
      status: "processing",
      localPath: null,
      updatedAt: { lt: cutoff },
    } as any,
    data: { status: "running" } as any,
  });
  if (result.count) {
    console.warn(`[finalize] recovered stale processing generation ${generationId}`);
  }
  return result.count;
}

export async function recoverStaleProcessing(staleMs = STALE_PROCESSING_MS) {
  const cutoff = new Date(Date.now() - staleMs);
  const result = await prisma.generation.updateMany({
    where: {
      status: "processing",
      localPath: null,
      updatedAt: { lt: cutoff },
    } as any,
    data: { status: "running" } as any,
  });
  if (result.count) {
    console.warn(`[finalize] recovered ${result.count} stale processing generation(s)`);
  }
  return result.count;
}
