import { z } from "zod";
import {
  creativeAgentApi,
  readCreativeAgentJson,
} from "@/lib/creative-agent/api";
import { requireCreativeAgentUser } from "@/lib/creative-agent/access";
import { creativeAgentCanvasIdSchema } from "@/lib/creative-agent/schemas";
import {
  readCreativeProject,
  updateCreativeProject,
  projectUpdateSchema,
} from "@/lib/creative-agent/project-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  return creativeAgentApi(async () => {
    const actor = await requireCreativeAgentUser(request);
    const sessionId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("sessionId"));
    const ids = new URL(request.url).searchParams.get("nodeIds");
    const nodeIds = ids
      ? z.array(z.string().min(1).max(256)).max(100).parse(JSON.parse(ids))
      : undefined;
    return readCreativeProject(
      actor,
      creativeAgentCanvasIdSchema.parse(params.id),
      sessionId,
      nodeIds,
    );
  });
}
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  return creativeAgentApi(async () => {
    const actor = await requireCreativeAgentUser(request, true);
    const { requestId, update } = z
      .object({ requestId: z.string().uuid(), update: projectUpdateSchema })
      .strict()
      .parse(await readCreativeAgentJson(request));
    return {
      project: await updateCreativeProject(
        actor,
        creativeAgentCanvasIdSchema.parse(params.id),
        update,
        requestId,
      ),
    };
  });
}
