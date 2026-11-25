import { apiMessage } from "@/i18n/api-message";
// 画布拉片（后台任务，刷新或关闭页面不会中断）：
//   POST   /api/canvas/shot-breakdown           body: { videoUrl, providerId, modelId } → 启动任务并以 NDJSON 推送
//   GET    /api/canvas/shot-breakdown?jobId=…   重新连上进行中的任务：先给当前进度与结果，再推送后续
//   DELETE /api/canvas/shot-breakdown?jobId=…   停止任务

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";
import { cancelBreakdownJob, findBreakdownJob, followBreakdownJob, startBreakdownJob } from "@/lib/canvas/shot-breakdown/jobs";
import type { BreakdownEvent } from "@/lib/canvas/shot-breakdown/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

const HEARTBEAT_MS = 15_000;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return json({ success: false, error: apiMessage("m48144f96c150") }, 401);
  const editorSessionId = req.headers.get("X-Canvas-Session-Id")?.trim() || "";
  const canvasId = Number(req.headers.get("X-Canvas-Id"));
  if ((editorSessionId || req.headers.has("X-Canvas-Id")) && (!editorSessionId || !Number.isSafeInteger(canvasId) || canvasId < 1 || !await canvasEditorSessionMatches(prisma, { authUserId, canvasId, sessionId: editorSessionId }))) {
    return json({ success: false, code: "CANVAS_SESSION_EXPIRED", error: apiMessage("m41fd87e42e8b") }, 409);
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const videoUrl = typeof body?.videoUrl === "string" ? body.videoUrl.trim() : "";
  const providerId = typeof body?.providerId === "string" ? body.providerId.trim() : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : "";
  if (!videoUrl || videoUrl.length > 4096) return json({ success: false, error: apiMessage("mb0316b2e5cb4") }, 400);
  if (!providerId || !modelId) return json({ success: false, error: apiMessage("m72a373c074c1") }, 400);

  const job = startBreakdownJob({ authUserId, videoUrl, providerId, modelId });
  return streamJob(req, job, true);
}

/** Streams a job to one page. Disconnecting stops only this stream, never the job. */
function streamJob(req: NextRequest, job: NonNullable<ReturnType<typeof findBreakdownJob>>, announce: boolean) {
  const encoder = new TextEncoder();
  let stop = () => undefined as void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unfollow();
        try { controller.close(); } catch { /* already closed by the client */ }
      };
      const emit = (event: BreakdownEvent) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { close(); return; }
        if (event.type === "done" || event.type === "error") queueMicrotask(close);
      };
      const heartbeat = setInterval(() => emit({ type: "ping" }), HEARTBEAT_MS);
      if (announce) emit({ type: "job", jobId: job.id });
      let unfollow = () => undefined as void;
      unfollow = followBreakdownJob(job, emit);
      stop = close;
      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() { stop(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

async function ownedJob(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return { response: json({ success: false, error: apiMessage("m48144f96c150") }, 401) };
  const job = findBreakdownJob(req.nextUrl.searchParams.get("jobId")?.trim() || "", authUserId);
  if (!job) return { response: json({ success: false, code: "BREAKDOWN_JOB_NOT_FOUND", error: apiMessage("m9424f5aa0f87") }, 404) };
  return { job };
}

export async function GET(req: NextRequest) {
  const { job, response } = await ownedJob(req);
  return job ? streamJob(req, job, false) : response;
}

export async function DELETE(req: NextRequest) {
  const { job, response } = await ownedJob(req);
  if (!job) return response;
  cancelBreakdownJob(job);
  return json({ success: true }, 200);
}
