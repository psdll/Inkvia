import { z } from "zod";
import {
  creativeAgentApi,
  readCreativeAgentJson,
} from "@/lib/creative-agent/api";
import { requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentCanvasIdSchema } from "@/lib/creative-agent/schemas";
import { branchCreativeConversation } from "@/lib/creative-agent/conversation-branch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  return creativeAgentApi(async () => {
    const actor = await requireCreativeAgentUser(request, true);
    const input = z
      .object({
        sessionId: z.string().uuid(),
        messageId: z.string().min(1).max(256),
        requestId: z.string().uuid(),
      })
      .strict()
      .parse(await readCreativeAgentJson(request));
    return {
      session: await branchCreativeConversation(
        actor,
        creativeAgentCanvasIdSchema.parse(params.id),
        input.sessionId,
        input.messageId,
        input.requestId,
      ),
    };
  });
}
