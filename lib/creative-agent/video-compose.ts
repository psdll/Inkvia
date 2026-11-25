import "server-only";
import prisma from "@/lib/prisma";
import { saveBufferFile } from "@/lib/storage";
import { getCanvasMediaNodeSize } from "@/lib/canvas/media-size";
import { getCanvasLocalUploadPositions } from "@/lib/canvas/material-placement";
import { submitCanvasMutation } from "@/lib/canvas/mutation-service";
import { createPrismaCanvasMutationStore } from "@/lib/canvas/prisma-mutation-store";
import type { CanvasOperation } from "@/lib/canvas/operations";
import { composeVideoClips, probeRuntimeMedia, type ComposeClip } from "./media-files";
import { locateCreativeMedia } from "./media-inspection";
import { readCreativeAgentCanvas } from "./canvas-tools";
import { CreativeAgentError } from "./errors";
import { recordComposedMedia } from "./composed-media";
import type { ToolExecutionInput } from "./tools";

type MediaTarget = { nodeId: string; semanticHash: string; batchId?: string; outputId?: string };
type Base = Omit<ToolExecutionInput, "kind" | "args">;

async function localMedia(base: Base, target: MediaTarget) {
  const located = await locateCreativeMedia({ ...base, kind: "media.inspect", args: target } as ToolExecutionInput);
  if (!located.storageRef) throw new CreativeAgentError("MEDIA_FILE_UNAVAILABLE", "有素材找不到本地文件，请重新上传后再合成", 400);
  return located as typeof located & { storageRef: string };
}

/**
 * 成片合成：把画布上的多段视频按顺序拼成一条，可加背景音乐与每段字幕，结果作为新视频节点放到画布上。
 * nodeId 由调用方按本次动作固定生成；同一动作重复执行时直接返回已有节点，不重复渲染。
 */
export async function composeCreativeVideo(base: Base, input: { nodeId: string; title: string; clips: { target: MediaTarget; caption?: string }[]; bgm?: { target: MediaTarget; volume: number }; keepOriginalAudio: boolean }) {
  const existing = (await readCreativeAgentCanvas(base.actorUserId, base.canvasId)).nodes.find(node => node.id === input.nodeId);
  if (existing?.data.kind === "video") return { nodeId: existing.id, url: existing.data.url, reused: true as const };

  const clips: ComposeClip[] = [];
  let width = 0, height = 0;
  for (const [index, clip] of input.clips.entries()) {
    const { kind, storageRef } = await localMedia(base, clip.target);
    if (kind !== "video") throw new CreativeAgentError("REFERENCE_KIND_INVALID", `第 ${index + 1} 段不是视频`, 400);
    const facts = await probeRuntimeMedia(storageRef, "video");
    if (facts.state !== "verified" || !facts.durationSeconds) throw new CreativeAgentError("MEDIA_DECODE_FAILED", `第 ${index + 1} 段视频无法解码`, 400);
    if (!width) ({ width = 1080, height = 1920 } = facts);
    clips.push({ storageRef, durationSeconds: facts.durationSeconds, hasAudio: Boolean(facts.audioCodecs?.length), caption: clip.caption });
  }
  // 成片尺寸跟第一段一致，长边不超过 1920
  const scale = Math.min(1, 1920 / Math.max(width, height));
  width = Math.round(width * scale); height = Math.round(height * scale);
  const bgm = input.bgm ? { storageRef: (await localMedia(base, input.bgm.target)).storageRef, volume: input.bgm.volume } : undefined;
  base.signal?.throwIfAborted();
  const bytes = await composeVideoClips(clips, { width, height, bgm, keepOriginalAudio: input.keepOriginalAudio }).catch(error => {
    throw new CreativeAgentError("VIDEO_COMPOSE_FAILED", `成片合成失败：${String((error as { stderr?: string }).stderr || (error as Error).message || "").trim().slice(-160) || "ffmpeg 出错"}`, 500);
  });
  const url = await saveBufferFile(bytes, "creative-agent", { contentType: "video/mp4", fallbackExt: "mp4" });
  await recordComposedMedia(base.canvasId, input.nodeId, { url, actorUserId: base.actorUserId });

  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await readCreativeAgentCanvas(base.actorUserId, base.canvasId);
    const sources = snapshot.nodes.filter(node => input.clips.some(clip => clip.target.nodeId === node.id));
    const right = sources.reduce((x, node) => Math.max(x, node.position.x + (node.width || 360)), 0);
    const top = sources.length ? Math.min(...sources.map(node => node.position.y)) : 0;
    const size = getCanvasMediaNodeSize(width, height);
    const position = getCanvasLocalUploadPositions([size], { x: right + 120, y: top }, snapshot.nodes)[0];
    const operation: CanvasOperation = { opId: `${input.nodeId}:node`, kind: "node.create", node: { id: input.nodeId, type: "video", position, ...size, data: { kind: "video", origin: "generated", url, name: input.title } } };
    try {
      const committed = await submitCanvasMutation({ actorUserId: base.actorUserId, canvasId: base.canvasId, input: { protocolVersion: 1, clientMutationId: input.nodeId, clientSequence: 0, baseRevision: snapshot.revision, operations: [operation] } }, createPrismaCanvasMutationStore(prisma));
      return { nodeId: input.nodeId, url, revision: committed.revision, durationSeconds: clips.reduce((sum, clip) => sum + clip.durationSeconds, 0), width, height, reused: false as const };
    } catch (error) {
      if ((error as { code?: string })?.code !== "CANVAS_REVISION_CONFLICT" || attempt === 2) throw error;
    }
  }
  throw new CreativeAgentError("CANVAS_REVISION_CONFLICT", "画布正在被修改，请稍后重试", 409);
}
