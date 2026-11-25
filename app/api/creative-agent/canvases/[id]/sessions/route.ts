import { creativeAgentApi, readCreativeAgentJson } from "@/lib/creative-agent/api";
import { requireCreativeAgentCanvas, requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentCanvasIdSchema, creativeAgentSessionIdSchema, creativeAgentCreateSessionSchema, creativeAgentRenameSessionSchema } from "@/lib/creative-agent/schemas";
import { creativeAgentStore } from "@/lib/creative-agent/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request);
    const canvasId = creativeAgentCanvasIdSchema.parse(params.id);
    await requireCreativeAgentCanvas(actorUserId, canvasId);
    const query = new URL(request.url).searchParams;
    if (query.get("list") === "1") return { sessions: await creativeAgentStore.listSessions(actorUserId, canvasId) };
    const sessionId = query.has("sessionId") ? creativeAgentSessionIdSchema.parse(query.get("sessionId")) : undefined;
    return creativeAgentStore.snapshot(actorUserId, canvasId, sessionId);
  });
}
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const canvasId = creativeAgentCanvasIdSchema.parse(params.id);
    await requireCreativeAgentCanvas(actorUserId, canvasId, true);
    const { sessionId } = creativeAgentCreateSessionSchema.parse(await readCreativeAgentJson(request));
    return { session: await creativeAgentStore.createSession(actorUserId, canvasId, sessionId) };
  });
}
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const canvasId = creativeAgentCanvasIdSchema.parse(params.id);
    await requireCreativeAgentCanvas(actorUserId, canvasId, true);
    const { sessionId, title } = creativeAgentRenameSessionSchema.parse(await readCreativeAgentJson(request));
    return { session: await creativeAgentStore.renameSession(actorUserId, canvasId, sessionId, title) };
  });
}
