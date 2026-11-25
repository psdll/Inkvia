import "server-only";
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { requireCreativeAgentCanvas, requireCreativeAgentUser } from "./access";
import { creativeAgentStore } from "./store";
import { CreativeAgentError } from "./errors";

export async function requireDebugUser(request: Request) {
  const actorUserId = await requireCreativeAgentUser(request);
  if (!isAdminRequest(request instanceof NextRequest ? request : new NextRequest(request))) throw new CreativeAgentError("DEBUG_FORBIDDEN", "需要管理员调试权限", 403);
  return actorUserId;
}
export async function requireDebugRun(request: Request, runId: string) {
  const actorUserId = await requireDebugUser(request);
  const run = await creativeAgentStore.getRun(runId, actorUserId);
  await requireCreativeAgentCanvas(actorUserId, run.canvasId);
  return run;
}
