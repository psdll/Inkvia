import { z } from "zod";
import { creativeAgentApi } from "@/lib/creative-agent/api";
import { requireCreativeAgentCanvas, requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentStore } from "@/lib/creative-agent/store";
import { CreativeAgentError } from "@/lib/creative-agent/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request);
    const after = z.coerce.number().int().nonnegative().safe().parse(new URL(request.url).searchParams.get("after") || 0);
    const run = await creativeAgentStore.getRun(params.id, actorUserId);
    if (!run) throw new CreativeAgentError("RUN_NOT_FOUND", "任务不存在", 404);
    await requireCreativeAgentCanvas(actorUserId, run.canvasId);
    return creativeAgentStore.events(run.id, actorUserId, after);
  });
}
