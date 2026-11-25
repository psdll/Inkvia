import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { releaseToolMedia } from "@/lib/tool-media/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const ownerUserId = await getUserId(req);
  if (!ownerUserId) {
    return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as {
    draftSessionId?: unknown;
    mediaIds?: unknown;
  } | null;
  const draftSessionId = String(body?.draftSessionId || "").trim();
  const mediaIds = Array.isArray(body?.mediaIds)
    ? Array.from(new Set(body.mediaIds.map((id) => String(id || "").trim())))
    : null;
  if (
    !UUID_PATTERN.test(draftSessionId)
    || mediaIds === null
    || mediaIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    return NextResponse.json({ success: false, error: apiMessage("mea854c6580d5") }, { status: 400 });
  }

  try {
    const result = await releaseToolMedia({
      ownerUserId,
      draftSessionId,
      mediaIds,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(String(error?.message || "释放素材失败")) },
      { status: 500 },
    );
  }
}
