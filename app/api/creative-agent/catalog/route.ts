import { creativeAgentApi } from "@/lib/creative-agent/api";
import { requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { getCreativeAgentModelCatalog } from "@/lib/creative-agent/model-catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return creativeAgentApi(async () => {
    await requireCreativeAgentUser(request);
    return getCreativeAgentModelCatalog();
  });
}
