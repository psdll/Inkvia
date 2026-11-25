import { creativeAgentApi, readCreativeAgentJson } from "@/lib/creative-agent/api";
import { requireCreativeAgentCanvas, requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentCanvasIdSchema, creativeAgentCreateSessionSchema } from "@/lib/creative-agent/schemas";
import { generateCreativeAgentSessionTitle } from "@/lib/creative-agent/session-title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const canvasId = creativeAgentCanvasIdSchema.parse(params.id);
    await requireCreativeAgentCanvas(actorUserId, canvasId, true);
    const { sessionId } = creativeAgentCreateSessionSchema.parse(await readCreativeAgentJson(request));
    return { session: await generateCreativeAgentSessionTitle(actorUserId, canvasId, sessionId) };
  });
}
