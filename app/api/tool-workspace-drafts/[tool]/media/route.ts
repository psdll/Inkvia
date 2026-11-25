import { apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { assertRequestContentLengthUnderLimit } from "@/lib/upload-limits";
import { normalizeToolWorkspaceTool } from "@/lib/tool-workspace-draft/contracts";
import {
  assertToolWorkspaceAccountGuard,
  toolWorkspaceDraftErrorResponse,
} from "@/lib/tool-workspace-draft/http";
import {
  getToolWorkspaceMediaUploadStatus,
  uploadAndAttachToolWorkspaceMedia,
} from "@/lib/tool-workspace-draft/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isFileLike(value: unknown): value is File {
  const file = value as File | null;
  return Boolean(
    file
      && typeof file.name === "string"
      && typeof file.type === "string"
      && typeof file.size === "number"
      && file.size > 0
      && typeof file.arrayBuffer === "function"
      && typeof file.slice === "function",
  );
}

export async function GET(req: Request, { params }: { params: { tool: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }
  try {
    assertToolWorkspaceAccountGuard(req, authUserId);
    const tool = normalizeToolWorkspaceTool(params.tool);
    const requestKey = new URL(req.url).searchParams.get("requestKey") || "";
    const result = await getToolWorkspaceMediaUploadStatus({
      authUserId,
      tool,
      requestKey,
    });
    return NextResponse.json(
      { success: true, ...result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toolWorkspaceDraftErrorResponse(error);
  }
}

export async function POST(req: Request, { params }: { params: { tool: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }
  try {
    assertToolWorkspaceAccountGuard(req, authUserId);
    const tool = normalizeToolWorkspaceTool(params.tool);
    assertRequestContentLengthUnderLimit(req);
    const form = await req.formData();
    const files = form.getAll("file");
    if (files.length !== 1 || !isFileLike(files[0])) {
      return NextResponse.json(
        { success: false, error: apiMessage("m49d9f9ad1329") },
        { status: 400 },
      );
    }
    const slot = String(form.get("slot") || "").trim() || null;
    const requestKey = String(form.get("requestKey") || "").trim() || undefined;
    const result = await uploadAndAttachToolWorkspaceMedia({
      authUserId,
      tool,
      file: files[0],
      slot: slot as "first" | "last" | null,
      requestKey,
    });
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    return toolWorkspaceDraftErrorResponse(error);
  }
}
