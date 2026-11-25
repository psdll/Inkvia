import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { personalFolderDownload } from "@/lib/canvas/personal-library";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserId(req); if (!user) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  try {
    const result = await personalFolderDownload(user, params.id);
    return new NextResponse(new Uint8Array(result.bytes), { headers: { "Content-Type": "application/zip", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}.zip` } });
  } catch (e) { return NextResponse.json({ error: apiErrorMessage((e as Error).message) }, { status: 400 }); }
}
