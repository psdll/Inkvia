import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { cancelCanvasRun, CanvasRunQueueError, getCanvasRunDetail } from "@/lib/canvas/run-queue";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function runId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function queueError(error: unknown) {
  if (error instanceof CanvasRunQueueError) {
    return NextResponse.json({ success: false, code: error.code, error: apiErrorMessage(error.message) }, { status: error.status });
  }
  throw error;
}

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = runId(params.runId);
  if (!id) return NextResponse.json({ success: false, error: apiMessage("m77f23fc8e4c0") }, { status: 400 });
  try {
    const run = await getCanvasRunDetail(prisma, { runId: id, authUserId });
    return NextResponse.json({ success: true, run });
  } catch (error) {
    return queueError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { runId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = runId(params.runId);
  if (!id) return NextResponse.json({ success: false, error: apiMessage("m77f23fc8e4c0") }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "cancel") {
    return NextResponse.json({ success: false, code: "RUN_ACTION_INVALID", error: "only cancellation is accepted from the browser" }, { status: 400 });
  }
  try {
    const run = await cancelCanvasRun(prisma, { runId: id, authUserId });
    return NextResponse.json({ success: true, run });
  } catch (error) {
    return queueError(error);
  }
}
