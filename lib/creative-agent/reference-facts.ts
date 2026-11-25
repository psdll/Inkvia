import "server-only";
import prisma from "@/lib/prisma";
import { generationOutputPaths } from "@/lib/generation/output-paths";
import type { CanvasNode } from "@/lib/canvas/document";
import { probeRuntimeMedia } from "./media-files";
import { resolvePreparedCreativeMedia } from "./reference-preparation";
import type { CreativeAgentToolInput } from "./canvas-tools";
import type { ResolvedReference } from "./media-capabilities";
import { CreativeAgentError } from "./errors";

/** Binding identity has already been checked against the owned canvas. Probing never trusts a caller URL alone. */
export async function bindCreativeReferenceFacts(input: CreativeAgentToolInput, node: CanvasNode, reference: ResolvedReference): Promise<ResolvedReference> {
  let storageRef: string | undefined;
  const data = node.data;
  const output = data.kind === "imageTask" ? data.task.batches.find(batch => batch.id === reference.batchId)?.outputs.find(output => output.id === reference.outputId) : undefined;
  const mediaId = reference.mediaId ?? output?.mediaId ?? ("mediaId" in data ? data.mediaId : undefined);
  const generationId = reference.generationId ?? output?.generationId ?? ("generationId" in data ? data.generationId : undefined);
  if (mediaId) {
    const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, purgedAt: null, status: "ready", OR: [{ ownerUserId: input.actorUserId }, { references: { some: { sourceType: "canvas_current", sourceId: { startsWith: `canvas:${input.canvasId}:node:` } } } }] } });
    if (asset?.kind === reference.kind && asset.publicUrl === reference.url && asset.publicUrl.startsWith("/uploads/")) storageRef = asset.publicUrl;
  }
  if (!storageRef && generationId) {
    const generation = await prisma.generation.findFirst({ where: { id: generationId, status: "success", OR: [{ authUserId: input.actorUserId }, { canvasId: input.canvasId }] } });
    if (generation && generationOutputPaths(generation).includes(reference.url) && reference.url.startsWith("/uploads/")) storageRef = reference.url;
  }
  if (!storageRef) storageRef = await resolvePreparedCreativeMedia(input, node) || undefined;
  if (!storageRef) throw new CreativeAgentError("REFERENCE_NOT_VERIFIED", "没有可核验权限和内容的本地参考素材；请先准备真实画布素材", 400);
  const facts = await probeRuntimeMedia(storageRef, reference.kind);
  if (facts.state !== "verified") throw new CreativeAgentError("REFERENCE_NOT_VERIFIED", "引用素材未通过媒体检测：" + (facts.reason || facts.state), 400);
  return { ...reference, url: storageRef, facts };
}
