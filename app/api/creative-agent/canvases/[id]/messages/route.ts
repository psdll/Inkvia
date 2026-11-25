import { creativeAgentApi, readCreativeAgentJson } from "@/lib/creative-agent/api";
import { requireCreativeAgentCanvas, requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentCanvasIdSchema, creativeAgentMessageSchema, creativeAgentMessageRevisionSchema } from "@/lib/creative-agent/schemas";
import { readCreativeAgentCanvas, resolveCreativeAgentSelection } from "@/lib/creative-agent/canvas-tools";
import { getCreativeAgentCapabilities } from "@/lib/creative-agent/config";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
import { validateCreativeAgentOptions, creativeAgentSupportsVision } from "@/lib/creative-agent/model-catalog";
import { resolveCreativeAgentAttachments } from "@/lib/creative-agent/attachments";
import { creativeAgentStore } from "@/lib/creative-agent/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const canvasId = creativeAgentCanvasIdSchema.parse(params.id);
    const input = creativeAgentMessageRevisionSchema.parse(await readCreativeAgentJson(request));
    await requireCreativeAgentCanvas(actorUserId, canvasId, true);
    const result = await creativeAgentStore.reviseMessage(actorUserId, canvasId, input);
    return creativeAgentStore.snapshot(actorUserId, canvasId, result.sessionId);
  });
}
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const canvasId = creativeAgentCanvasIdSchema.parse(params.id);
    const input = { ...creativeAgentMessageSchema.parse(await readCreativeAgentJson(request)), actorUserId, canvasId };
    await requireCreativeAgentCanvas(actorUserId, canvasId, true);
    const duplicate = await creativeAgentStore.findSubmission(input);
    if (duplicate) return { success: true, sessionId: duplicate.sessionId, runId: duplicate.run.id };
    const capabilities = await getCreativeAgentCapabilities(input.model);
    if (!capabilities.ready) throw new CreativeAgentError("AGENT_NOT_READY", capabilities.reason || "Agent 尚未就绪", 503);
    const route = await validateCreativeAgentOptions(input, { deferMedia: true });
    const attachments = await resolveCreativeAgentAttachments(input);
    if (!creativeAgentSupportsVision(route.providerId, route.modelId) && attachments.some(record => record.mimeType.startsWith("image/"))) throw new CreativeAgentError("MODEL_VISION_UNSUPPORTED", "所选模型未声明图像输入能力", 400);
    const snapshot = await readCreativeAgentCanvas(actorUserId, canvasId);
    if (snapshot.revision !== input.baseRevision) throw new CreativeAgentError("CANVAS_REVISION_CONFLICT", "画布已有更新，请等待保存同步后再发送");
    const resolvedSelection = resolveCreativeAgentSelection(canvasId, snapshot, input.selection);
    const result = await creativeAgentStore.enqueue({ ...input, resolvedSelection });
    return { success: true, sessionId: result.sessionId, runId: result.run.id };
  });
}
