import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { subscribeCanvasUploadDeletion } from "@/lib/canvas/local-media-events";
import { onServerStreamShutdown } from "@/lib/server-stream-shutdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCanvasId(value: string | null) {
  const canvasId = Number(value);
  return Number.isSafeInteger(canvasId) && canvasId > 0 ? canvasId : null;
}

export async function GET(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const canvasId = parseCanvasId(req.nextUrl.searchParams.get("canvasId"));
  if (!canvasId) return NextResponse.json({ success: false, error: apiMessage("mf9f4ac787a10") }, { status: 400 });
  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, authUserId, deletedAt: null },
    select: { id: true },
  });
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  const signal = req.signal;
  if (signal?.aborted) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let cancelled = false;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let unsubscribeShutdown = () => {};
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribeShutdown();
        signal?.removeEventListener("abort", cleanup);
        if (!cancelled) controller.close();
      };
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      unsubscribe = subscribeCanvasUploadDeletion((url) => {
        void Promise.all([
          prisma.canvasNodeState.count({
            where: { canvasId, data: { path: ["data", "url"], equals: url } },
          }),
          prisma.mediaAsset.count({ where: { ownerUserId: authUserId, publicUrl: url } }),
        ]).then(([nodeCount, ownedMediaCount]) => {
          if (nodeCount || ownedMediaCount) send("media-deleted", { url });
        }).catch(() => undefined);
      });
      signal?.addEventListener("abort", cleanup, { once: true });
      unsubscribeShutdown = onServerStreamShutdown(cleanup);
      if (signal?.aborted) cleanup();
    },
    cancel() {
      cancelled = true;
      cleanup();
    },
  });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
