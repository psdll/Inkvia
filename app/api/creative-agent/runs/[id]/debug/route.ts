import { z } from "zod";
import { creativeAgentApi } from "@/lib/creative-agent/api";
import { requireDebugRun } from "@/lib/creative-agent/debug-access";
import { readDebugBatch, readDebugDetails, requireDebugStorage } from "@/lib/creative-agent/debug-store";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return creativeAgentApi(async () => {
    const run = await requireDebugRun(request, params.id);
    await requireDebugStorage();
    const query = new URL(request.url).searchParams;
    const after = z.coerce.number().int().nonnegative().safe().parse(query.get("after") || 0);
    if (query.get("details") === "1") {
      const spanId = z.string().max(200).optional().parse(query.get("spanId") || undefined);
      return readDebugDetails(run.id, spanId, after);
    }
    const publicAfter = z.coerce.number().int().nonnegative().safe().parse(query.get("publicAfter") || 0);
    return readDebugBatch(run, after, publicAfter);
  });
}
