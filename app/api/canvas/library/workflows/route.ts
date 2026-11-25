import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { parseCanvasDocumentV2 } from "@/lib/canvas/document";
import { addBuffer, addFolder } from "@/lib/canvas/library";
import { MAX_CANVAS_JSON_BYTES } from "@/lib/canvas/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  try {
    const body = await request.json() as { title?: unknown; document?: unknown };
    const document = parseCanvasDocumentV2(body?.document);
    const json = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(json, "utf8") > MAX_CANVAS_JSON_BYTES) {
      return NextResponse.json({ success: false, error: apiMessage("mc19ecfe7bde2") }, { status: 413 });
    }
    const title = String(body?.title || "canvas").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "canvas";
    await addFolder(userId, "workflows");
    const item = await addBuffer(userId, Buffer.from(json, "utf8"), { ext: "canvas.json", name: `${title}.canvas.json`, folder: "workflows" });
    return NextResponse.json({ success: true, item });
  } catch (error) {
    return NextResponse.json({ success: false, error: apiErrorMessage(String((error as Error)?.message || "工作流入库失败")) }, { status: 400 });
  }
}
