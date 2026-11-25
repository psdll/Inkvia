import "server-only";
import { z } from "zod";
import prisma from "@/lib/prisma";
import {
  probeRuntimeMedia,
  runtimeVisionParts,
} from "@/lib/creative-agent/media-files";
import { generationOutputPaths } from "@/lib/generation/output-paths";
import { readCreativeAgentCanvas, creativeAgentNodeHash } from "./canvas-tools";
import { creativeAgentStore } from "./store";
import {
  resolveCreativeAgentModel,
  creativeAgentSupportsVision,
} from "./model-catalog";
import { CreativeAgentError } from "./errors";
import { resolvePreparedCreativeMedia } from "./reference-preparation";
import { composedMediaUrl } from "./composed-media";
import type { ToolExecutionInput } from "./tools";

/** 找到节点对应、且有权限读取的本地素材文件；没有可校验的本地文件时 storageRef 为空 */
export async function locateCreativeMedia(input: ToolExecutionInput) {
  const args = z
    .object({
      nodeId: z.string().min(1),
      semanticHash: z.string().length(64),
      batchId: z.string().optional(),
      outputId: z.string().optional(),
    })
    .strict()
    .parse(input.args);
  const canvas = await readCreativeAgentCanvas(
    input.actorUserId,
    input.canvasId,
  );
  const node = canvas.nodes.find((item) => item.id === args.nodeId);
  if (!node || creativeAgentNodeHash(node) !== args.semanticHash)
    throw new CreativeAgentError(
      "REFERENCE_CHANGED",
      "观察目标已变化，请重新读取节点",
      409,
    );
  let mediaId: string | undefined,
    generationId: number | undefined,
    url: string | undefined,
    kind: "image" | "video" | "audio";
  const data = node.data;
  if (data.kind === "imageTask") {
    const output = data.task.batches
      .find((batch) => batch.id === args.batchId)
      ?.outputs.find((output) => output.id === args.outputId);
    if (!output || output.status !== "success")
      throw new CreativeAgentError(
        "REFERENCE_NOT_READY",
        "请选择具体的已完成图片输出",
        400,
      );
    ({ mediaId, generationId, url } = output);
    kind = "image";
  } else if (
    data.kind === "image" ||
    data.kind === "video" ||
    data.kind === "audio"
  ) {
    ({ mediaId, url } = data);
    kind = data.kind;
  } else if (data.kind === "videoTask" || data.kind === "audioTask") {
    if (
      data.status !== "success" ||
      !args.outputId ||
      args.outputId !== data.requestKey
    )
      throw new CreativeAgentError(
        "REFERENCE_NOT_READY",
        "请选择具体的已完成媒体输出",
        400,
      );
    generationId = data.generationId;
    url = data.outputUrl;
    mediaId = "mediaId" in data ? data.mediaId : undefined;
    kind = data.kind === "videoTask" ? "video" : "audio";
  } else
    throw new CreativeAgentError(
      "REFERENCE_KIND_INVALID",
      "该节点不是媒体结果",
      400,
    );
  let storageRef: string | undefined;
  if (mediaId) {
    const asset = await prisma.mediaAsset.findFirst({
      where: {
        id: mediaId,
        purgedAt: null,
        status: "ready",
        OR: [
          { ownerUserId: input.actorUserId },
          {
            references: {
              some: {
                sourceType: "canvas_current",
                sourceId: { startsWith: `canvas:${input.canvasId}:node:` },
              },
            },
          },
        ],
      },
    });
    if (asset?.kind === kind && asset.publicUrl?.startsWith("/uploads/"))
      storageRef = asset.publicUrl;
  }
  if (!storageRef && generationId) {
    const generation = await prisma.generation.findFirst({
      where: {
        id: generationId,
        status: "success",
        OR: [{ authUserId: input.actorUserId }, { canvasId: input.canvasId }],
      },
    });
    if (generation && url && generationOutputPaths(generation).includes(url))
      storageRef = url;
  }
  if (!storageRef && data.kind === "video") storageRef = await composedMediaUrl(input.canvasId, node.id, data.url);
  if (!storageRef) storageRef = await resolvePreparedCreativeMedia(input, node) || undefined;
  return { args, node, kind, storageRef };
}

export async function inspectCreativeMedia(
  input: ToolExecutionInput,
): Promise<Record<string, unknown>> {
  const { args, node, kind, storageRef } = await locateCreativeMedia(input);
  if (!storageRef)
    return {
      nodeId: node.id,
      observed: false,
      coverage: "未观察",
      reason:
        "没有可校验权限的本地素材文件；请上传此素材作为附件。未读取远程地址。",
    };
  const facts = await probeRuntimeMedia(storageRef, kind);
  if (facts.state !== "verified")
    return {
      nodeId: node.id,
      observed: false,
      facts,
      coverage: "解码失败或解码工具不可用，未观察内容",
    };
  const run = await creativeAgentStore.assertFence(input.runId, input.epoch);
  const resolved = await resolveCreativeAgentModel(run.input.model);
  const vision =
    resolved.status === "ready" &&
    creativeAgentSupportsVision(
      resolved.route.providerId,
      resolved.route.modelId,
    );
  const images =
    vision && kind !== "audio"
      ? (await runtimeVisionParts(storageRef, facts)).map((part) => ({
          data: part.image_url.url.split(",")[1],
          mimeType: "image/jpeg",
        }))
      : [];
  return {
    nodeId: node.id,
    semanticHash: args.semanticHash,
    facts,
    images,
    observed: images.length > 0,
    coverage:
      kind === "audio"
        ? "仅音频元数据；声音未分析，无转录"
        : images.length
          ? kind === "image"
            ? "缩放后的单帧图像"
            : "视频0%、50%、90%三张抽样帧；不能证明完整动作、镜头或声音，声音未分析"
          : "仅元数据；当前模型没有声明图像理解能力",
  };
}
