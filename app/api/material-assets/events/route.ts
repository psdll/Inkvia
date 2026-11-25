import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { subscribeMaterialChanges } from "@/lib/material-live-events";
import { onServerStreamShutdown } from "@/lib/server-stream-shutdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser(request))) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  if (request.signal.aborted) return new Response(null, { status: 204 });
  const encoder = new TextEncoder();
  let cancelled = false;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribeShutdown = () => {};
      const send = (text: string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
      const unsubscribe = subscribeMaterialChanges(revision => send(`event: changed\ndata: ${JSON.stringify({ revision })}\n\n`));
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), 15000);
      // Reconnect periodically so revoked/expired sessions are authenticated again.
      const lifetime = setTimeout(() => cleanup(), 5 * 60 * 1000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe(); clearInterval(heartbeat); clearTimeout(lifetime);
        unsubscribeShutdown();
        request.signal.removeEventListener("abort", cleanup);
        if (!cancelled) controller.close();
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      unsubscribeShutdown = onServerStreamShutdown(cleanup);
      if (request.signal.aborted) cleanup();
    },
    cancel() { cancelled = true; cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "private, no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
