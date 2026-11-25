import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { resolveUploadsRootDirectory } from "@/lib/storage";
import { isPrivateUploadPath } from "@/lib/private-upload-path";
import { resolveAssetUrlForExternalApi } from "@/lib/external-assets";
import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";
import { probeCanvasMedia } from "./media-upload-service";
import { subtitleRemovalSchema, type SubtitleRemovalOptions } from "./subtitle-removal";
import { MediaKitError, requireMediaKitProvider, submitMediaKitSubtitleRemoval, uploadMediaKitVideo } from "@/lib/volcengine-mediakit";
import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_MODEL } from "@/lib/volcengine-mediakit-models";
import { runGenerationRequestIdempotently } from "@/lib/generation/request-key-idempotency";
import { reserveRuntimeGeneration } from "@/lib/runtime-generation-budget";
import { assertBillingReady } from "@/lib/billing/admission";
import { upsertUsageLedgerForGenerationId } from "@/lib/billing-ledger";

async function prepareSubtitleVideoUrl(url: string, source: string, size: number) {
  const usePlatform = (await getMediaDeliveryMode()) === "platform";
  let nativeReason = "";
  if (usePlatform) {
    try {
      return await uploadMediaKitVideo(source, size);
    } catch (error) {
      nativeReason = error instanceof Error ? error.message : "AI MediaKit 本地上传失败";
    }
  }
  try {
    const videoUrl = await resolveAssetUrlForExternalApi(url, "canvas-provider-inputs");
    if (!/^https?:\/\//i.test(videoUrl)) {
      throw new Error("请配置公网素材地址，或在系统设置中配置阿里云 OSS 中转，火山无法访问本地视频");
    }
    return videoUrl;
  } catch (error) {
    if (!usePlatform) throw error;
    const relayReason = error instanceof Error ? error.message : "阿里云 OSS 中转失败，请检查系统设置";
    throw new Error(`${nativeReason}。${relayReason}`);
  }
}

export async function createSubtitleRemovalGeneration(input: {
  sourceUrl: string; options: SubtitleRemovalOptions; authUserId: number; requestKey: string; canvasId?: number;
}) {
  return runGenerationRequestIdempotently({
    requestKey: input.requestKey,
    findExisting: () => prisma.generation.findFirst({ where: { requestKey: input.requestKey, authUserId: input.authUserId, model: MEDIAKIT_SUBTITLE_MODEL } }),
    mapExisting: record => {
      if (record.status === "failed") throw new MediaKitError(record.errorMsg || "去字幕任务失败", 409);
      return { generationId: record.id };
    },
    execute: async () => {
      let videoUrl: string;
      let duration: number;
      let options: SubtitleRemovalOptions;
      try {
        await requireMediaKitProvider();
        options = subtitleRemovalSchema.parse(input.options);
        const url = input.sourceUrl;
        if (!url.startsWith("/uploads/") || url.includes("..") || url.includes("\\") || url.includes("\0") || isPrivateUploadPath(url.slice(9))) throw new Error("请先将视频上传到画布后再去字幕");
        const root = await fs.realpath(resolveUploadsRootDirectory());
        const source = await fs.realpath(path.resolve(root, url.slice(9)));
        if (!source.startsWith(root + path.sep)) throw new Error("视频路径无效");
        const stat = await fs.stat(source);
        if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error("去字幕视频不能超过 512 MB");
        const probe = await probeCanvasMedia(source, "video");
        if (!probe.width || !probe.height || !probe.durationSeconds || !Number.isFinite(probe.durationSeconds) || probe.durationSeconds > 300) throw new Error("去字幕暂支持 5 分钟以内的视频");
        duration = probe.durationSeconds;
        await assertBillingReady(MEDIAKIT_SUBTITLE_MODEL, MEDIAKIT_PROVIDER);
        videoUrl = await prepareSubtitleVideoUrl(url, source, stat.size);
        await reserveRuntimeGeneration(input.requestKey);
      } catch (error) {
        throw new MediaKitError(error instanceof Error ? error.message : "去字幕参数无效", 400);
      }
      const record = await prisma.generation.create({ data: {
        userId: String(input.authUserId), authUserId: input.authUserId, requestKey: input.requestKey, canvasId: input.canvasId,
        type: "video_gen", source: "canvas", prompt: "", model: MEDIAKIT_SUBTITLE_MODEL, status: "running",
        externalProvider: MEDIAKIT_PROVIDER, externalTaskId: null,
        templateData: JSON.stringify({ model: MEDIAKIT_SUBTITLE_MODEL, provider: MEDIAKIT_PROVIDER, providerModel: "erase-video-subtitle-pro", modelVersion: "v5", subtitleRemoval: options, duration, billing: { unitType: "minute" } }),
      } });
      try {
        const taskId = await submitMediaKitSubtitleRemoval({ videoUrl, options, requestKey: input.requestKey });
        await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: taskId } });
        void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
        return { generationId: record.id };
      } catch (error) {
        if (error instanceof MediaKitError && error.status >= 400 && error.status < 500) {
          await prisma.generation.update({ where: { id: record.id }, data: { status: "failed", errorMsg: error.message, finishedAt: new Date() } });
          throw new MediaKitError(error.message, error.status);
        }
        // A timeout may have happened after the paid request reached the provider.
        // Keep the request record; never silently re-submit it with a new token.
        throw new Error("火山去字幕提交结果未确认，请先在 AI MediaKit 控制台核对任务，避免重复提交");
      }
    },
  });
}
