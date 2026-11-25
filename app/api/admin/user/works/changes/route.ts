import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope } from "@/lib/admin-user-scope";
import { getAdminUserWorksChanges, normalizeAdminWorksSourceFilter, parseAdminWorksAdminKey, safeLimit } from "@/lib/admin-user-works";
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

  const sinceUpdatedAt = String(searchParams.get("sinceUpdatedAt") || "").trim();
  const sinceIdRaw = Number(searchParams.get("sinceId"));
  const sinceId = searchParams.has("sinceId") && Number.isSafeInteger(sinceIdRaw) && sinceIdRaw >= 0 ? sinceIdRaw : null;
  if (!sinceUpdatedAt || Number.isNaN(new Date(sinceUpdatedAt).getTime()) || sinceId == null) {
    return bad("sinceUpdatedAt and sinceId are required");
  }
  const sinceSourceEventIdRaw = Number(searchParams.get("sinceSourceEventId"));
  const sinceSourceEventId = searchParams.has("sinceSourceEventId")
    && Number.isSafeInteger(sinceSourceEventIdRaw)
    && sinceSourceEventIdRaw >= 0
    ? sinceSourceEventIdRaw
    : null;
  if (searchParams.has("sinceSourceEventId") && sinceSourceEventId == null) {
    return bad("invalid sinceSourceEventId");
  }
  const scope = await resolveAdminUserScope(userId, authUserId, { explicitIdentity: Boolean(explicitIdentity) });
  const scopeKey = explicitIdentity?.adminKey || (scope.authUserId == null ? `guest:${scope.requestedUserId}` : `auth:${scope.authUserId}`);
  const limit = safeLimit(searchParams.get("limit"), 100);
  const kind = String(searchParams.get("kind") || "generated").trim().toLowerCase();
  const typeFilter = String(searchParams.get("typeFilter") || "all").trim().toLowerCase();
  const source = String(searchParams.get("source") || "creation").trim().toLowerCase();
  const batchModeRaw = String(searchParams.get("batchMode") || "").trim();
  if (source === "batch" && batchModeRaw && !isAssetBatchMode(batchModeRaw)) {
    return bad("invalid batchMode");
  }
  const sourceFilter = normalizeAdminWorksSourceFilter(source, batchModeRaw);
  const queryStartedAt = performance.now();
  const payload = await getAdminUserWorksChanges({
    scope,
    sinceUpdatedAt,
    sinceId,
    sinceSourceEventId,
    limit,
    kind,
    typeFilter,
    sourceFilter,
    cardsOnly: searchParams.get("view") === "cards",
  });
  observeAdminLatency("works_changes_query", performance.now() - queryStartedAt);
  observeAdminLatency("works_changes_api", performance.now() - apiStartedAt);

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
