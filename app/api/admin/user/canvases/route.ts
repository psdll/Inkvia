import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { parseAdminWorksAdminKey } from "@/lib/admin-user-works";
import { CanvasProjectionStateError, readCanvasBootstrapPage } from "@/lib/canvas/prisma-mutation-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);
  const query = req.nextUrl.searchParams;
  const identity = parseAdminWorksAdminKey(query.get("adminKey"));
  if (!identity) return json({ error: apiMessage("mdac0f82c5099") }, 400);
  const canvasIdRaw = query.get("canvasId");
  const canvasId = Number(canvasIdRaw);
  if (canvasIdRaw !== null && (!Number.isSafeInteger(canvasId) || canvasId <= 0)) return json({ error: apiMessage("mb38f1644afae") }, 400);
  if (identity.authUserId === null) return canvasIdRaw !== null
    ? json({ error: apiMessage("m7f806c0c420d") }, 404) : json({ items: [], hasMore: false });
  try {
    if (canvasIdRaw === null) {
      const page = Number(query.get("page") || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return json({ error: apiMessage("m757bbbda2913") }, 400);
      const search = (query.get("q") || "").trim().slice(0, 100);
      const rows = await prisma.canvas.findMany({
        where: { authUserId: identity.authUserId, deletedAt: null, ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}) },
        select: { id: true, title: true, thumbnail: true, updatedAt: true, nodeCount: true, edgeCount: true, revision64: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 30, take: 31,
      });
      return json({ items: rows.slice(0, 30).map(({ revision64, ...row }) => ({ ...row, revision: revision64.toString() })), hasMore: rows.length > 30 });
    }
    // Admin identity is checked above; ownership is checked separately from membership.
    const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, authUserId: identity.authUserId, deletedAt: null }, select: { id: true } });
    if (!canvas) return json({ error: apiMessage("md69122253a29") }, 404);
    const base = query.get("baseRevision");
    const known = query.get("knownRevision");
    if ([base, known].some(value => value !== null && !/^\d{1,19}$/.test(value))) return json({ error: apiMessage("mb459caf7827c") }, 400);
    const limit = Number(query.get("limit") || 500);
    const page = await readCanvasBootstrapPage(prisma, {
      canvasId, actorUserId: identity.authUserId, readOnly: true,
      baseRevision: base === null ? undefined : BigInt(base),
      knownRevision: known === null ? undefined : BigInt(known),
      nodeCursor: query.get("nodeCursor") || undefined, edgeCursor: query.get("edgeCursor") || undefined,
      limit: Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 1000)) : 500,
    });
    if (page.kind === "not_found" || page.kind === "forbidden") return json({ error: apiMessage("mf204dd127669") }, 404);
    if (page.kind === "conflict") return json({ code: "BOOTSTRAP_REVISION_CHANGED", currentRevision: page.currentRevision }, 409);
    return json({ success: true, ...page });
  } catch (error) {
    if (error instanceof CanvasProjectionStateError) return json({ error: apiMessage("m87fb9bcdbfed"), code: error.code }, error.status);
    console.error("admin canvas read failed", error);
    return json({ error: apiMessage("m8fa195d2ca0b") }, 500);
  }
}
