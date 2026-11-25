import { NextResponse } from "next/server";
import { ToolWorkspaceDraftError } from "@/lib/tool-workspace-draft/contracts";

export function assertToolWorkspaceAccountGuard(req: Request, authUserId: number) {
  const guardedUserId = String(req.headers.get("x-tool-workspace-account") || "").trim();
  if (!guardedUserId || guardedUserId !== String(authUserId)) {
    throw new ToolWorkspaceDraftError(
      "登录账号已变化，请刷新页面后重试",
      409,
      "TOOL_WORKSPACE_ACCOUNT_CHANGED",
    );
  }
}

export function toolWorkspaceDraftErrorResponse(error: unknown) {
  if (error instanceof ToolWorkspaceDraftError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  const candidate = error as { message?: unknown; status?: unknown; code?: unknown } | null;
  const status = Number(candidate?.status);
  return NextResponse.json(
    {
      success: false,
      error: String(candidate?.message || "保存工作草稿失败"),
      ...(typeof candidate?.code === "string" ? { code: candidate.code } : {}),
    },
    { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500 },
  );
}
