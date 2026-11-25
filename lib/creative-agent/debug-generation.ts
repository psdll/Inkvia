import "server-only";
import { currentCreativeTrace, recordCreativeDebug, withCreativeDebug, withDebugSpan, type TraceScope } from "./debug-trace";

/** Reconnect an existing paid task to its originating run in a different worker process. */
export async function withGenerationDebug<T>(generation: { id: number; source?: string; requestKey?: string | null; authUserId?: number | null; canvasId?: number | null }, work: () => Promise<T>): Promise<T> {
  if (generation.source !== "agent" || !generation.requestKey) return work();
  const spanId = `media:${generation.requestKey}`;
  const observe = async () => {
    try {
      const result = await work();
      recordCreativeDebug({ spanId, category: "media", type: "media.poll", title: `后台任务 #${generation.id} · ${String(result)}`, status: result === "done" ? "success" : result === "failed" ? "error" : "waiting", eventKey: `finalize:${generation.id}:${String(result)}`, summary: { generationId: generation.id, finalizeResult: String(result) } });
      return result;
    } catch (error) {
      recordCreativeDebug({ spanId, category: "media", type: "media.poll.error", title: `后台任务 #${generation.id} 查询中断`, status: "unknown", summary: { generationId: generation.id } });
      throw error;
    }
  };
  if (currentCreativeTrace()) return withDebugSpan(spanId, observe);
  let scope: TraceScope | undefined;
  try {
    const prisma = (await import("@/lib/prisma")).default;
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; actor_user_id: number; canvas_id: number; epoch: number }>>(`SELECT r.id,r.actor_user_id,r.canvas_id,r.epoch FROM "CreativeAgentAction" a JOIN "CreativeAgentRun" r ON r.id=a.run_id WHERE a.kind IN ('image.generate','video.generate') AND a.result->'mediaDispatch'->'requestKeys' ? $1 AND r.actor_user_id=$2 AND r.canvas_id=$3 LIMIT 1`, generation.requestKey, generation.authUserId, generation.canvasId);
    if (rows[0]) scope = { runId: rows[0].id, actorUserId: rows[0].actor_user_id, canvasId: Number(rows[0].canvas_id), epoch: rows[0].epoch };
  } catch { /* The finalizer works even when tracing is unavailable. */ }
  return scope ? withCreativeDebug(scope, () => withDebugSpan(spanId, observe)) : work();
}
