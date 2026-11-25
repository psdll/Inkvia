import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { changeProductFolders, getProductFolders } from "@/lib/media-library-folders-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  try { return NextResponse.json({ folders: await getProductFolders(user.id) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: apiErrorMessage((error as Error).message) }, { status: 400 }); }
}
export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  try { return NextResponse.json(await changeProductFolders(user.id, await request.json())); }
  catch (error) { return NextResponse.json({ error: apiErrorMessage((error as Error).message) }, { status: 400 }); }
}
