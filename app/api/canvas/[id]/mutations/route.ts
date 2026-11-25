import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { CanvasLimitError } from "@/lib/canvas/limits";
import { CanvasMutationContractError } from "@/lib/canvas/mutation-contract";
import { CanvasOperationError } from "@/lib/canvas/operations";
import { CanvasMutationServiceError, submitCanvasMutation } from "@/lib/canvas/mutation-service";
import {
  CanvasProjectionStateError,
  CanvasMediaReferenceError,
  createPrismaCanvasMutationStore,
  readCanvasMutationPage,
} from "@/lib/canvas/prisma-mutation-store";
import { canvasMetrics } from "@/lib/canvas/observability";
import { tryAcquireCanvasMutation } from "@/lib/canvas/mutation-admission";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mutationStore = createPrismaCanvasMutationStore(prisma);

function parseCanvasId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseRevision(value: string | null): bigint | null {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof CanvasMutationContractError) {
    return NextResponse.json({
      success: false,
      code: error.code,
      error: apiErrorMessage(error.message),
      issues: error.issues?.map((issue) => ({ path: issue.path, message: issue.message })),
    }, { status: 400 });
  }
  if (error instanceof CanvasMutationServiceError) {
    return NextResponse.json({
      success: false,
      code: error.code,
      error: apiErrorMessage(error.message),
      ...(error.details ?? {}),
    }, { status: error.status });
  }
  if (error instanceof CanvasLimitError || error instanceof CanvasOperationError) {
    return NextResponse.json({ success: false, code: error.code, error: apiErrorMessage(error.message) }, { status: 422 });
  }
  if (error instanceof CanvasProjectionStateError) {
    return NextResponse.json({ success: false, code: error.code, error: apiErrorMessage(error.message) }, {
      status: error.status,
      headers: { "Retry-After": "3" },
    });
  }
  if (error instanceof CanvasMediaReferenceError) {
    return NextResponse.json({ success: false, code: error.code, error: apiErrorMessage(error.message) }, { status: error.status });
  }
  console.error("canvas mutation failed", error);
  return NextResponse.json({ success: false, code: "CANVAS_MUTATION_FAILED", error: "Canvas mutation failed" }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const startedAt = Date.now();
  const actorUserId = await getUserId(req);
  if (!actorUserId) return NextResponse.json({ success: false, code: "UNAUTHORIZED", error: "Please sign in" }, { status: 401 });
  const canvasId = parseCanvasId(params.id);
  if (!canvasId) return NextResponse.json({ success: false, code: "CANVAS_ID_INVALID", error: "Invalid canvas ID" }, { status: 400 });
  const editorSessionId = req.headers.get("X-Canvas-Session-Id")?.trim();
  if (!editorSessionId || !await canvasEditorSessionMatches(prisma, {
    authUserId: actorUserId,
    canvasId,
    sessionId: editorSessionId,
  })) {
    return NextResponse.json({
      success: false,
      code: "CANVAS_SESSION_EXPIRED",
      error: "Canvas editor session expired",
    }, { status: 409 });
  }
  const permit = tryAcquireCanvasMutation();
  if (!permit) {
    canvasMetrics.increment("canvas_mutation_rejected_total");
    return NextResponse.json({
      success: false,
      code: "CANVAS_MUTATION_OVERLOADED",
      error: "Canvas write capacity is temporarily full; retry the local WAL later",
    }, { status: 429, headers: { "Retry-After": "1" } });
  }

  try {
    const input = await req.json().catch(() => null);
    if (!input) return NextResponse.json({ success: false, code: "MUTATION_REQUEST_INVALID", error: "Invalid request body" }, { status: 400 });
    const result = await submitCanvasMutation({ canvasId, actorUserId, input }, mutationStore);
    canvasMetrics.increment("canvas_mutation_total");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CanvasMutationServiceError && error.code === "CANVAS_REVISION_CONFLICT") {
      canvasMetrics.increment("canvas_mutation_conflict_total");
    }
    return errorResponse(error);
  } finally {
    permit.release();
    canvasMetrics.observe("canvas_mutation_duration_ms", Date.now() - startedAt);
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actorUserId = await getUserId(req);
  if (!actorUserId) return NextResponse.json({ success: false, code: "UNAUTHORIZED", error: "Please sign in" }, { status: 401 });
  const canvasId = parseCanvasId(params.id);
  const afterRevision = parseRevision(req.nextUrl.searchParams.get("afterRevision"));
  if (!canvasId || afterRevision === null) {
    return NextResponse.json({ success: false, code: "MUTATION_CURSOR_INVALID", error: "Invalid canvas ID or revision cursor" }, { status: 400 });
  }

  try {
    const page = await readCanvasMutationPage(prisma, { canvasId, actorUserId, afterRevision });
    if (page.kind === "not_found") return NextResponse.json({ success: false, code: "CANVAS_NOT_FOUND", error: "Canvas not found" }, { status: 404 });
    if (page.kind === "forbidden") return NextResponse.json({ success: false, code: "CANVAS_FORBIDDEN", error: "Canvas access denied" }, { status: 403 });
    return NextResponse.json({ success: true, ...page });
  } catch (error) {
    return errorResponse(error);
  }
}
