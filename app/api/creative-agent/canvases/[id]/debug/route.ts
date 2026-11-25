import { z } from "zod";
import { creativeAgentApi } from "@/lib/creative-agent/api";
import { requireCreativeAgentCanvas } from "@/lib/creative-agent/access";
import { requireDebugUser } from "@/lib/creative-agent/debug-access";
import { readDebugIndex, requireDebugStorage } from "@/lib/creative-agent/debug-store";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const userId = await requireDebugUser(request);
    const canvasId = z.coerce.number().int().positive().safe().parse(params.id);
    await requireCreativeAgentCanvas(userId, canvasId);
    await requireDebugStorage();
    const query = new URL(request.url).searchParams;
    const sessionId = z.string().max(128).optional().parse(query.get("sessionId") || undefined);
    const before = z.string().max(128).optional().parse(query.get("before") || undefined);
    return readDebugIndex(userId, canvasId, sessionId, before);
  });
}
