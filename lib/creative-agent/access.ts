import "server-only";

import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { hasSameRequestOrigin } from "@/lib/request-origin";
import { assertDurableWorkAdmission } from "@/lib/maintenance";
import { CreativeAgentError } from "./errors";

export async function requireCreativeAgentUser(request: Request, write = false) {
  if (write && !hasSameRequestOrigin(request)) {
    throw new CreativeAgentError("ORIGIN_REJECTED", "请求来源无效", 403);
  }
  const actorUserId = await getUserId(request);
  if (!actorUserId) throw new CreativeAgentError("UNAUTHORIZED", "请先登录", 401);
  if (write) await assertDurableWorkAdmission();
  return actorUserId;
}

export async function requireCreativeAgentCanvas(actorUserId: number, canvasId: number, write = false) {
  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, deletedAt: null },
    select: {
      authUserId: true, revision64: true,
      members: { where: { userId: actorUserId }, select: { role: true } },
    },
  });
  const allowed = canvas && (canvas.authUserId === actorUserId || canvas.members.some(member =>
    (write ? ["OWNER", "EDITOR"] : ["OWNER", "EDITOR", "VIEWER"]).includes(member.role)));
  if (!allowed) throw new CreativeAgentError("CANVAS_NOT_FOUND", "画布不存在或没有访问权限", 404);
  return { revision: canvas.revision64.toString() };
}
