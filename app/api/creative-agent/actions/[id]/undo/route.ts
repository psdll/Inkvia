import { creativeAgentApi } from "@/lib/creative-agent/api";
import { requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { undoCreativeAction } from "@/lib/creative-agent/undo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  return creativeAgentApi(async () =>
    undoCreativeAction(
      await requireCreativeAgentUser(request, true),
      params.id,
    ),
  );
}
