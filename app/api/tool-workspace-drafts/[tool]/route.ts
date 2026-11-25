import { apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { normalizeToolWorkspaceTool } from "@/lib/tool-workspace-draft/contracts";
import {
  assertToolWorkspaceAccountGuard,
  toolWorkspaceDraftErrorResponse,
} from "@/lib/tool-workspace-draft/http";
import {
  getToolWorkspaceDraft,
  saveToolWorkspaceDraft,
} from "@/lib/tool-workspace-draft/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { tool: string } };

export async function GET(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }
  try {
    const tool = normalizeToolWorkspaceTool(params.tool);
    const draft = await getToolWorkspaceDraft({ authUserId, tool });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    return toolWorkspaceDraftErrorResponse(error);
  }
}

export async function PATCH(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }
  try {
    assertToolWorkspaceAccountGuard(req, authUserId);
    const tool = normalizeToolWorkspaceTool(params.tool);
    const body = await req.json();
    const draft = await saveToolWorkspaceDraft({
      authUserId,
      tool,
      expectedVersion: body?.expectedVersion,
      payload: body?.payload,
      media: body && Object.prototype.hasOwnProperty.call(body, "media")
        ? body.media
        : undefined,
    });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    return toolWorkspaceDraftErrorResponse(error);
  }
}
