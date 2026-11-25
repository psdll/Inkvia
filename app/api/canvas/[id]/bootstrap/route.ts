import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { CanvasProjectionStateError, readCanvasBootstrapPage } from "@/lib/canvas/prisma-mutation-store";
import { canvasMetrics } from "@/lib/canvas/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCanvasId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseOptionalRevision(value: string | null): bigint | undefined | null {
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const startedAt = Date.now();
  const actorUserId = await getUserId(req);
  if (!actorUserId) return NextResponse.json({ success: false, code: "UNAUTHORIZED", error: "Please sign in" }, { status: 401 });
  const canvasId = parseCanvasId(params.id);
  const baseRevision = parseOptionalRevision(req.nextUrl.searchParams.get("baseRevision"));
  const knownRevision = parseOptionalRevision(req.nextUrl.searchParams.get("knownRevision"));
  if (!canvasId || baseRevision === null || knownRevision === null) {
    return NextResponse.json({ success: false, code: "BOOTSTRAP_CURSOR_INVALID", error: "Invalid canvas ID or revision" }, { status: 400 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") || 500);
  const nodeCursor = req.nextUrl.searchParams.get("nodeCursor") || undefined;
  const edgeCursor = req.nextUrl.searchParams.get("edgeCursor") || undefined;
  try {
    const page = await readCanvasBootstrapPage(prisma, {
      canvasId,
      actorUserId,
      baseRevision,
      knownRevision,
      readOnly: req.nextUrl.searchParams.get("prefetch") === "1",
      nodeCursor,
      edgeCursor,
      limit: Number.isSafeInteger(limit) ? limit : 500,
    });
    if (page.kind === "not_found") return NextResponse.json({ success: false, code: "CANVAS_NOT_FOUND", error: "Canvas not found" }, { status: 404 });
    if (page.kind === "forbidden") return NextResponse.json({ success: false, code: "CANVAS_FORBIDDEN", error: "Canvas access denied" }, { status: 403 });
    if (page.kind === "conflict") {
      return NextResponse.json({ success: false, code: "BOOTSTRAP_REVISION_CHANGED", currentRevision: page.currentRevision }, { status: 409 });
    }
    return NextResponse.json({ success: true, ...page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CanvasProjectionStateError) {
      return NextResponse.json({ success: false, code: error.code, error: apiErrorMessage(error.message) }, {
        status: error.status,
        headers: { "Retry-After": "3" },
      });
    }
    console.error("canvas bootstrap failed", error);
    return NextResponse.json({ success: false, code: "CANVAS_BOOTSTRAP_FAILED", error: "Canvas bootstrap failed" }, { status: 500 });
  } finally {
    canvasMetrics.observe("canvas_bootstrap_duration_ms", Date.now() - startedAt);
  }
}
