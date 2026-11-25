import "server-only";
import prisma from "@/lib/prisma";
import { requireCreativeAgentCanvas } from "./access";
import { creativeAgentStableId } from "./canvas-tools";
import { CreativeAgentError } from "./errors";
import { creativeAgentStore } from "./store";

/** Fork at a whole user turn; never replay tools or discard the original audit trail. */
export async function branchCreativeConversation(
  actorUserId: number,
  canvasId: number,
  sessionId: string,
  messageId: string,
  requestId: string,
) {
  await requireCreativeAgentCanvas(actorUserId, canvasId, true);
  const source = await creativeAgentStore.getSession(
    actorUserId,
    canvasId,
    sessionId,
  );
  const id = creativeAgentStableId(
    `branch:${actorUserId}:${sessionId}:${messageId}:${requestId}`,
  );
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`creative-agent:canvas:${canvasId}`},0))::text`;
    if (
      (
        await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "CreativeAgentSession" WHERE id=${id}`
      ).length
    )
      return;
    const running = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "CreativeAgentRun" WHERE session_id=${sessionId} AND status NOT IN ('completed','failed','stopped') LIMIT 1`;
    if (running.length)
      throw new CreativeAgentError(
        "SESSION_BUSY",
        "请先结束这段对话的运行再创建分支",
        409,
      );
    const targets = await tx.$queryRaw<
      { created_at: Date; run_id: string }[]
    >`SELECT r.created_at,m.run_id FROM "CreativeAgentMessage" m JOIN "CreativeAgentRun" r ON r.id=m.run_id WHERE m.id=${messageId} AND m.session_id=${sessionId}`;
    if (!targets.length)
      throw new CreativeAgentError("MESSAGE_NOT_FOUND", "消息不存在", 404);
    const cutoff = targets[0].created_at;
    const sessions = await tx.$queryRaw<
      { transcript: { timestamp?: number; role?: string }[] }[]
    >`SELECT transcript FROM "CreativeAgentSession" WHERE id=${sessionId} AND actor_user_id=${actorUserId} FOR UPDATE`;
    const transcript = sessions[0].transcript;
    const turn = transcript.findIndex(
      (item) => item.role === "user" && item.timestamp === cutoff.getTime(),
    );
    // Assistant/tool timestamps can vary; the user timestamp is the durable run identity.
    if (turn < 0 && transcript.length)
      throw new CreativeAgentError(
        "BRANCH_POINT_INVALID",
        "无法定位完整对话边界，请新建空白对话以避免混用历史",
        409,
      );
    const history = turn >= 0 ? transcript.slice(0, turn) : [];
    await tx.$executeRaw`INSERT INTO "CreativeAgentSession"(id,actor_user_id,canvas_id,title,title_source,transcript) VALUES(${id},${actorUserId},${canvasId},${`${source.title.slice(0, 60)} · 分支`},'manual',${JSON.stringify(history)}::jsonb)`;
    const messages = await tx.$queryRaw<
      {
        id: string;
        run_id: string;
        role: string;
        text: string;
        reference_data: unknown;
        created_at: Date;
      }[]
    >`SELECT m.* FROM "CreativeAgentMessage" m JOIN "CreativeAgentRun" r ON r.id=m.run_id WHERE m.session_id=${sessionId} AND r.created_at < ${cutoff} ORDER BY m.created_at,m.id`;
    for (const message of messages) {
      const messageCopy = creativeAgentStableId(`${id}:${message.id}`);
      await tx.$executeRaw`INSERT INTO "CreativeAgentMessage"(id,session_id,run_id,role,text,reference_data,created_at) VALUES(${messageCopy},${id},${message.run_id},${message.role},${message.text},${JSON.stringify(message.reference_data)}::jsonb,${message.created_at})`;
    }
  });
  return creativeAgentStore.getSession(actorUserId, canvasId, id);
}
