import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope } from "@/lib/admin-user-scope";
import { getAdminUserWorkIds, getAdminUserFailedWorkIds, getAdminUserWorkDetail, getAdminUserWorks, normalizeAdminWorksSourceFilter, parseAdminWorksAdminKey, safePage, safePageSize } from "@/lib/admin-user-works";
import { decodeAdminWorksCursor } from "@/lib/admin-user-works-cursor";
import { observeAdminLatency } from "@/lib/admin-observability";
import { isAssetBatchMode } from "@/lib/assets/source-filter";

export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

function safeUserId(v: string) {
  const s = (v || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) return "";
  if (s === "_builtin") return "";
  return s;
}

export async function GET(req: NextRequest) {
  const apiStartedAt = performance.now();
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const { searchParams } = new URL(req.url);
  const explicitIdentity = parseAdminWorksAdminKey(searchParams.get("adminKey"));
  if (searchParams.has("adminKey") && !explicitIdentity) return bad("invalid adminKey");
  const userId = explicitIdentity?.userId || safeUserId(searchParams.get("userId") || "");
  const authUserIdRaw = Number(searchParams.get("authUserId") || "");
  const authUserId = explicitIdentity?.authUserId ?? (Number.isFinite(authUserIdRaw) ? authUserIdRaw : null);
  if (!userId) return bad("invalid userId");

  const scope = await resolveAdminUserScope(userId, authUserId, { explicitIdentity: Boolean(explicitIdentity) });
  const scopeKey = explicitIdentity?.adminKey || (scope.authUserId == null ? `guest:${scope.requestedUserId}` : `auth:${scope.authUserId}`);
  if (searchParams.has("detailId")) {
    const id = Number(searchParams.get("detailId"));
    if (!Number.isSafeInteger(id) || id <= 0) return bad("invalid detailId");
    const item = await getAdminUserWorkDetail(scope, id);
    return NextResponse.json({ scopeKey, item }, {
      status: item ? 200 : 404, headers: { "Cache-Control": "no-store" },
    });
  }
  if (searchParams.get("failedIdsOnly") === "1") {
    const queryStartedAt = performance.now();
    const failedIds = await getAdminUserFailedWorkIds(scope);
    observeAdminLatency("works_failed_ids_query", performance.now() - queryStartedAt);
    observeAdminLatency("works_api", performance.now() - apiStartedAt);
    return NextResponse.json(
      {
        scopeKey,
        userId,
        authUserId: scope.authUserId,
        linkedUserIds: scope.linkedUserIds,
        failedIds,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const page = safePage(searchParams.get("page"), 1);
  const pageSize = Math.min(searchParams.get("view") === "cards" ? 60 : 1000, safePageSize(searchParams.get("limit") || searchParams.get("pageSize"), 40));
  let cursor = null;
  if (searchParams.has("cursor")) {
    try {
      cursor = decodeAdminWorksCursor(String(searchParams.get("cursor") || ""));
    } catch {
      return bad("invalid cursor");
    }
  }
  const all = searchParams.get("view") !== "cards" && searchParams.get("all") === "1";
  const kind = String(searchParams.get("kind") || "generated").trim().toLowerCase();
  const typeFilter = String(searchParams.get("typeFilter") || "all").trim().toLowerCase();
  const source = String(searchParams.get("source") || "creation").trim().toLowerCase();
  const batchModeRaw = String(searchParams.get("batchMode") || "").trim();
  if (source === "batch" && batchModeRaw && !isAssetBatchMode(batchModeRaw)) {
    return bad("invalid batchMode");
  }
  const sourceFilter = normalizeAdminWorksSourceFilter(source, batchModeRaw);
  const from = searchParams.has('from') ? new Date(searchParams.get('from')!) : null;
  const to = searchParams.has('to') ? new Date(searchParams.get('to')!) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return bad('invalid date range');
  const queryStartedAt = performance.now();
  if (searchParams.get("idsOnly") === "1") {
    const ids = await getAdminUserWorkIds({ scope, kind, typeFilter, sourceFilter, from, to });
    return NextResponse.json({ scopeKey, ids }, { headers: { "Cache-Control": "no-store" } });
  }
  const payload = await getAdminUserWorks({ scope, page, pageSize, kind, typeFilter, sourceFilter, all, cursor, cardsOnly: searchParams.get("view") === "cards", from, to });
  observeAdminLatency("works_query", performance.now() - queryStartedAt);
  observeAdminLatency("works_api", performance.now() - apiStartedAt);

  return NextResponse.json(
    {
      scopeKey,
      userId,
      authUserId: scope.authUserId,
      linkedUserIds: scope.linkedUserIds,
      ...payload
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
