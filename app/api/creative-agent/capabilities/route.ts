import { z } from "zod";
import { getUserId } from "@/lib/server-auth";
import { creativeAgentApi } from "@/lib/creative-agent/api";
import { getCreativeAgentCapabilities } from "@/lib/creative-agent/config";
import { CreativeAgentError } from "@/lib/creative-agent/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return creativeAgentApi(async () => {
    if (!await getUserId(request)) throw new CreativeAgentError("UNAUTHORIZED", "请先登录", 401);
    const query = new URL(request.url).searchParams;
    const model = query.has("modelId") ? z.object({ providerId: z.string().min(1).max(256), modelId: z.string().min(1).max(256) }).parse({ providerId: query.get("providerId"), modelId: query.get("modelId") }) : undefined;
    return getCreativeAgentCapabilities(model);
  });
}
