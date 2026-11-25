import { creativeAgentApi, readCreativeAgentJson } from "@/lib/creative-agent/api";
import { requireCreativeAgentCanvas, requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentControlSchema } from "@/lib/creative-agent/schemas";
import { creativeAgentStore } from "@/lib/creative-agent/store";
import { CreativeAgentError } from "@/lib/creative-agent/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const input = creativeAgentControlSchema.parse(await readCreativeAgentJson(request));
    const run = await creativeAgentStore.getRun(params.id, actorUserId);
    if (!run) throw new CreativeAgentError("RUN_NOT_FOUND", "任务不存在", 404);
    await requireCreativeAgentCanvas(actorUserId, run.canvasId, true);
    return creativeAgentStore.control(run.id, actorUserId, input.requestId, input.action);
  });
}
