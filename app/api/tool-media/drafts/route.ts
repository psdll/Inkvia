import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { listToolMediaDrafts } from "@/lib/tool-media/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseMediaIds(value: string | null, limit = 20) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of String(value || "").split(",")) {
    const mediaId = candidate.trim().toLowerCase();
    if (!UUID_PATTERN.test(mediaId) || seen.has(mediaId)) continue;
    seen.add(mediaId);
    ids.push(mediaId);
    if (ids.length >= limit) break;
  }
  return ids;
}

export async function GET(req: Request) {
  const ownerUserId = await getUserId(req);
  if (!ownerUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }

  const searchParams = new URL(req.url).searchParams;
  const draftSessionId = searchParams.get("draftSessionId")?.trim() || "";
  const mediaIds = parseMediaIds(searchParams.get("mediaIds"));
  if (!UUID_PATTERN.test(draftSessionId)) {
    return NextResponse.json({ success: false, error: apiMessage("m5e7f56b8a91b") }, { status: 400 });
  }

  try {
    const items = await listToolMediaDrafts({ ownerUserId, draftSessionId, mediaIds });
    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(String(error?.message || "查询草稿素材失败")) },
      { status: 500 },
    );
  }
}
