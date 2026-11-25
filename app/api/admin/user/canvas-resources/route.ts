import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { parseAdminWorksAdminKey } from "@/lib/admin-user-works";
import { getCanvasAssetHistory, getCanvasAssetDetail } from "@/lib/assets/canvas-history-server";
import { getPersonalLibrary, personalFolderDownload } from "@/lib/canvas/personal-library";
import { readPersonalMaterialResponse } from "@/lib/canvas/personal-material-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

// A closed set of read operations; never forwards cookies or impersonates a login.
export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);
  const identity = parseAdminWorksAdminKey(req.nextUrl.searchParams.get("adminKey"));
  if (!identity?.authUserId) return json({ error: apiMessage("mdac0f82c5099") }, 400);
  const resource = req.nextUrl.searchParams.get("resource") || "";
  if (!resource.startsWith("/api/") || resource.includes("\\")) return json({ error: apiMessage("m652be445302e") }, 400);
  const url = new URL(resource, req.url);
  const owner = identity.authUserId;
  // Preview owner is derived from verified identity, never an independently supplied ID.
  url.searchParams.set("owner", String(owner));
  const readRequest = new NextRequest(url, { headers: { range: req.headers.get("range") || "" } });
  try {
    if (url.pathname === "/api/assets") return await getCanvasAssetHistory(readRequest, owner);
    const history = /^\/api\/assets\/(\d+)$/.exec(url.pathname);
    if (history) return await getCanvasAssetDetail(readRequest, Number(history[1]), owner);
    if (url.pathname === "/api/canvas/materials") return json({ success: true, library: await getPersonalLibrary(owner, true) });
    const file = /^\/api\/canvas\/materials\/([^/]+)\/file$/.exec(url.pathname);
    if (file) return await readPersonalMaterialResponse(readRequest, owner, decodeURIComponent(file[1]), true);
    const folder = /^\/api\/canvas\/materials\/folders\/([^/]+)\/download$/.exec(url.pathname);
    if (folder) {
      const result = await personalFolderDownload(owner, decodeURIComponent(folder[1]), true);
      return new NextResponse(new Uint8Array(result.bytes), { headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}.zip` } });
    }
    return json({ error: apiMessage("ma37ec2441e61") }, 404);
  } catch (error) {
    console.error("admin canvas resource read failed", error);
    return json({ error: apiMessage("m78e6a4eee8e0") }, 500);
  }
}
