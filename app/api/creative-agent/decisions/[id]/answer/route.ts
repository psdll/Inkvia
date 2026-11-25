import { creativeAgentApi, readCreativeAgentJson } from "@/lib/creative-agent/api";
import { requireCreativeAgentCanvas, requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentAnswerSchema } from "@/lib/creative-agent/schemas";
import { creativeAgentStore } from "@/lib/creative-agent/store";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const input = creativeAgentAnswerSchema.parse(await readCreativeAgentJson(request));
    const decision = await prisma.creativeAgentDecision.findUnique({ where: { id: params.id }, select: { runId: true } });
    const run = decision ? await creativeAgentStore.getRun(decision.runId, actorUserId) : null;
    if (!run) throw new CreativeAgentError("DECISION_NOT_FOUND", "待确认事项不存在", 404);
    await requireCreativeAgentCanvas(actorUserId, run.canvasId, true);
    return creativeAgentStore.answerDecision(params.id, actorUserId, input.requestId, input.proposalHash, input.answer);
  });
}
