import { apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { normalizeToolWorkspaceTool, ToolWorkspaceDraftError } from "@/lib/tool-workspace-draft/contracts";
import {
  assertToolWorkspaceAccountGuard,
  toolWorkspaceDraftErrorResponse,
} from "@/lib/tool-workspace-draft/http";
import { detachToolWorkspaceMedia } from "@/lib/tool-workspace-draft/service";

type Context = { params: { tool: string; relationId: string } };

export async function DELETE(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }
  try {
    assertToolWorkspaceAccountGuard(req, authUserId);
    const tool = normalizeToolWorkspaceTool(params.tool);
    if (!/^\d+$/.test(params.relationId)) {
      throw new ToolWorkspaceDraftError(
        "素材关系 ID 无效",
        400,
        "TOOL_WORKSPACE_MEDIA_ID_INVALID",
      );
    }
    const result = await detachToolWorkspaceMedia({
      authUserId,
      tool,
      relationId: BigInt(params.relationId),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return toolWorkspaceDraftErrorResponse(error);
  }
}
